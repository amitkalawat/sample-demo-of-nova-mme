# CloudFront Signed URLs Implementation Guide

## Overview

This guide provides step-by-step instructions to implement CloudFront Signed URLs with AWS Secrets Manager for secure video/image delivery in the Nova MME application.

**Goal:** Ensure only authenticated users can access media files through CloudFront while maintaining performance.

**Architecture:**
1. Generate RSA key pair (private + public)
2. Store private key in AWS Secrets Manager (encrypted with KMS)
3. Upload public key to CloudFront Key Group
4. Lambda retrieves private key from Secrets Manager (with caching)
5. Lambda signs URLs with configurable expiration
6. CloudFront validates signatures before serving content

---

## Prerequisites

- AWS CLI configured with appropriate credentials
- OpenSSL installed
- Docker installed (for building Lambda layer)
- CDK deployed environment

---

## Step 1: Generate RSA Key Pair

```bash
cd /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/deployment

# Generate 2048-bit RSA private key
openssl genrsa -out cloudfront_private_key.pem 2048

# Extract public key
openssl rsa -pubout -in cloudfront_private_key.pem -out cloudfront_public_key.pem

# Verify keys were created
ls -lh cloudfront_*.pem
```

**Security Note:** Keep `cloudfront_private_key.pem` secure and do NOT commit to Git!

---

## Step 2: Build Lambda Layer with Cryptography Library

### Create requirements.txt

```bash
cat > /tmp/cf-signing-requirements.txt << 'EOF'
cryptography==42.0.5
aws-secretsmanager-caching==1.2.0
EOF
```

### Build Layer using Docker

```bash
# Create directory for layer
mkdir -p /tmp/cloudfront-signing-layer/python

# Build using Docker (ensures binary compatibility with Lambda)
docker run --platform linux/amd64 \
  -v /tmp/cf-signing-requirements.txt:/requirements.txt \
  -v /tmp/cloudfront-signing-layer:/layer \
  public.ecr.aws/lambda/python:3.13 \
  /bin/sh -c "pip install -r /requirements.txt -t /layer/python/lib/python3.13/site-packages/"

# Create zip file
cd /tmp/cloudfront-signing-layer
zip -r cloudfront-signing-layer.zip python

# Upload to S3
aws s3 cp cloudfront-signing-layer.zip s3://nova-mme-${CDK_DEFAULT_ACCOUNT}-us-east-1/lambda-layers/

# Cleanup
cd -
rm -rf /tmp/cloudfront-signing-layer /tmp/cf-signing-requirements.txt
```

---

## Step 3: Create CloudFront Signer Utility Module

Create the file: `/Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/cloudfront_signer.py`

```python
"""
CloudFront Signed URL Generator with Secrets Manager Caching
"""
import os
import datetime
from botocore.signers import CloudFrontSigner
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from aws_secretsmanager_caching import SecretCache, SecretCacheConfig
import botocore.session

# Global cache for Secrets Manager (persists across Lambda warm starts)
_secret_cache = None
_cloudfront_key_pair_id = None

def get_secret_cache():
    """Initialize Secrets Manager cache (singleton pattern)"""
    global _secret_cache
    if _secret_cache is None:
        client = botocore.session.get_session().create_client('secretsmanager')
        cache_config = SecretCacheConfig(
            max_cache_size=10,
            exception_retry_delay_base=1,
            exception_retry_growth_factor=2,
            exception_retry_delay_max=30,
            default_version_stage='AWSCURRENT',
            secret_refresh_interval=3600  # Refresh every hour
        )
        _secret_cache = SecretCache(config=cache_config, client=client)
    return _secret_cache

def get_cloudfront_key_pair_id():
    """Get CloudFront Key Pair ID from environment variable"""
    global _cloudfront_key_pair_id

    if _cloudfront_key_pair_id is None:
        _cloudfront_key_pair_id = os.environ.get('CLOUDFRONT_KEY_PAIR_ID')
        if not _cloudfront_key_pair_id:
            raise ValueError("CLOUDFRONT_KEY_PAIR_ID environment variable not set")

    return _cloudfront_key_pair_id

def rsa_signer(message):
    """
    RSA signing function using private key from Secrets Manager
    This function is called by CloudFrontSigner for each URL
    """
    cache = get_secret_cache()

    # Retrieve private key from Secrets Manager (cached)
    secret_name = os.environ.get('CLOUDFRONT_PRIVATE_KEY_SECRET',
                                   '/cloudfront/signing-key/private-key')
    private_key_pem = cache.get_secret_string(secret_name)

    # Load the private key
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode('utf-8'),
        password=None,
        backend=default_backend()
    )

    # Sign the message using RSA-SHA1 (CloudFront requirement)
    signature = private_key.sign(
        message,
        padding.PKCS1v15(),
        hashes.SHA1()
    )

    return signature

def generate_signed_url(url, expiration_minutes=60):
    """
    Generate a CloudFront signed URL

    Args:
        url (str): CloudFront URL to sign (e.g., https://d123.cloudfront.net/tasks/video.mp4)
        expiration_minutes (int): URL expiration time in minutes (default: 60)

    Returns:
        str: Signed CloudFront URL

    Raises:
        ValueError: If CLOUDFRONT_KEY_PAIR_ID is not set
        Exception: If signing fails
    """
    key_pair_id = get_cloudfront_key_pair_id()

    # Calculate expiration time
    expire_date = datetime.datetime.now() + datetime.timedelta(minutes=expiration_minutes)

    # Create CloudFront signer
    cloudfront_signer = CloudFrontSigner(key_pair_id, rsa_signer)

    # Generate signed URL with canned policy
    signed_url = cloudfront_signer.generate_presigned_url(
        url,
        date_less_than=expire_date
    )

    return signed_url
```

Copy this file to both Lambda directories:

```bash
cp /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/cloudfront_signer.py \
   /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/nova-srv-get-video-tasks/

cp /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/cloudfront_signer.py \
   /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/nova-srv-search-vector/
```

---

## Step 4: Update CDK Infrastructure

### 4.1 Update `frontend_stack.py`

Add to `/Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/deployment/frontend/frontend_stack.py`:

**Add imports at the top:**

```python
from aws_cdk import (
    # ... existing imports ...
    aws_secretsmanager as secretsmanager,
    aws_ssm as _ssm,
)
```

**Add method to create signing infrastructure (add after `__init__`):**

```python
def deploy_cloudfront_signing_keys(self):
    """Create CloudFront public key and key group for signed URLs"""

    # Create Secrets Manager secret for private key
    # Note: The actual private key value will be uploaded manually after deployment
    self.cloudfront_private_key_secret = secretsmanager.Secret(
        self,
        "CloudFrontPrivateKey",
        secret_name="/cloudfront/signing-key/private-key",
        description="CloudFront private key for signing URLs",
        # Secret value will be set manually via AWS CLI
    )

    # Read the public key from file
    with open('cloudfront_public_key.pem', 'r') as f:
        public_key_content = f.read()

    # Create CloudFront Public Key
    self.cf_public_key = _cloudfront.CfnPublicKey(
        self,
        "CloudFrontPublicKey",
        public_key_config=_cloudfront.CfnPublicKey.PublicKeyConfigProperty(
            caller_reference=f"nova-mme-{self.account}-{self.region}",
            name="NovaMMESigningKey",
            encoded_key=public_key_content,
            comment="Public key for CloudFront signed URLs in Nova MME"
        )
    )

    # Create CloudFront Key Group
    self.cf_key_group = _cloudfront.CfnKeyGroup(
        self,
        "CloudFrontKeyGroup",
        key_group_config=_cloudfront.CfnKeyGroup.KeyGroupConfigProperty(
            name="NovaMMEKeyGroup",
            items=[self.cf_public_key.attr_id],
            comment="Key group for Nova MME signed URLs"
        )
    )

    # Store Key Pair ID in SSM for Lambda functions
    _ssm.StringParameter(
        self,
        "CloudFrontKeyPairId",
        parameter_name="/nova-mme/cloudfront-key-pair-id",
        string_value=self.cf_public_key.attr_id,
        description="CloudFront public key ID for signed URL generation"
    )
```

**Update `__init__` method to call the new method:**

```python
def __init__(self, scope: Construct, construct_id: str, **kwargs):
    # ... existing code ...

    # Deploy CloudFront signing infrastructure
    self.deploy_cloudfront_signing_keys()

    # Deploy CloudFront distribution (this should already exist)
    self.deploy_cloudfront()
```

**Update `deploy_cloudfront()` method to enable signed URLs:**

Find the behavior for `tasks/*` and add `trusted_key_groups`:

```python
# Data bucket origin (for videos, images, audio) - REQUIRES SIGNING
_cloudfront.SourceConfiguration(
    s3_origin_source=_cloudfront.S3OriginConfig(
        s3_bucket_source=data_bucket,
        origin_access_identity=cf_oai_data
    ),
    behaviors=[_cloudfront.Behavior(
        path_pattern="tasks/*",
        viewer_protocol_policy=_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowed_methods=_cloudfront.CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
        cached_methods=_cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
        default_ttl=Duration.hours(24),
        max_ttl=Duration.hours(48),
        min_ttl=Duration.hours(1),
        compress=True,
        # Add trusted key groups for signed URLs
        trusted_key_groups=[self.cf_key_group.attr_id],
    )]
)
```

### 4.2 Update `nova_service_stack.py`

Add Lambda layer and update IAM permissions in `/Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/deployment/nova_service/nova_service_stack.py`:

**Add CloudFront signing layer in `deploy_lambda()` method:**

```python
def deploy_lambda(self):
    # ... existing layer code (boto3_layer, etc.) ...

    # Add CloudFront signing layer
    layer_bucket = _s3.Bucket.from_bucket_name(
        self,
        "LayerBucket",
        bucket_name=self.s3_bucket_name_mm
    )

    self.cloudfront_signing_layer = _lambda.LayerVersion(
        self,
        'CloudFrontSigningLayer',
        code=_lambda.S3Code(
            bucket=layer_bucket,
            key='lambda-layers/cloudfront-signing-layer.zip'
        ),
        compatible_runtimes=[_lambda.Runtime.PYTHON_3_13],
        description="CloudFront URL signing with cryptography and Secrets Manager caching"
    )
```

**Update Lambda role for `nova-srv-get-video-tasks`:**

```python
lambda_es_get_tasks_role = _iam.Role(
    self, "NovaSrvLambdaGetTasksRole",
    assumed_by=_iam.ServicePrincipal("lambda.amazonaws.com"),
    inline_policies={"nova-srv-get-tasks-poliy": _iam.PolicyDocument(
        statements=[
            # ... existing S3, DynamoDB statements ...

            # Add Secrets Manager permissions
            _iam.PolicyStatement(
                effect=_iam.Effect.ALLOW,
                actions=[
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret"
                ],
                resources=[
                    f"arn:aws:secretsmanager:{self.region}:{self.account}:secret:/cloudfront/signing-key/*"
                ]
            ),
            # Add SSM permissions (optional, for key pair ID)
            _iam.PolicyStatement(
                effect=_iam.Effect.ALLOW,
                actions=["ssm:GetParameter"],
                resources=[
                    f"arn:aws:ssm:{self.region}:{self.account}:parameter/nova-mme/cloudfront-key-pair-id"
                ]
            ),
        ]
    )}
)
```

**Update Lambda role for `nova-srv-search-vector`:**

```python
lambda_es_get_task_frames_role = _iam.Role(
    self, "NovaLambdaSearchVectorRole",
    assumed_by=_iam.ServicePrincipal("lambda.amazonaws.com"),
    inline_policies={"nova-srv-search-vector-poliy": _iam.PolicyDocument(
        statements=[
            # ... existing statements ...

            # Add Secrets Manager permissions
            _iam.PolicyStatement(
                effect=_iam.Effect.ALLOW,
                actions=[
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret"
                ],
                resources=[
                    f"arn:aws:secretsmanager:{self.region}:{self.account}:secret:/cloudfront/signing-key/*"
                ]
            ),
            # Add SSM permissions
            _iam.PolicyStatement(
                effect=_iam.Effect.ALLOW,
                actions=["ssm:GetParameter"],
                resources=[
                    f"arn:aws:ssm:{self.region}:{self.account}:parameter/nova-mme/cloudfront-key-pair-id"
                ]
            ),
        ]
    )}
)
```

**Update Lambda environment variables (find the `create_api_endpoint` calls):**

For `nova-srv-get-video-tasks`:

```python
self.create_api_endpoint(
    id='NovaSrvGetTasksEp',
    # ... existing parameters ...
    evns={
        'DYNAMO_VIDEO_TASK_TABLE': DYNAMO_VIDEO_TASK_TABLE,
        'S3_PRE_SIGNED_URL_EXPIRY_S': S3_PRE_SIGNED_URL_EXPIRY_S,
        'CLOUDFRONT_DOMAIN': 'd3qbit2yf1heat.cloudfront.net',
        'CLOUDFRONT_PRIVATE_KEY_SECRET': '/cloudfront/signing-key/private-key',
        'CLOUDFRONT_KEY_PAIR_ID': self.frontend_stack.cf_public_key.attr_id,
        'CLOUDFRONT_URL_EXPIRATION_MINUTES': '60',
    }
)
```

For `nova-srv-search-vector`:

```python
self.create_api_endpoint(
    id='NovaLambdaSearchVectorEp',
    # ... existing parameters ...
    evns={
        'DYNAMO_VIDEO_TASK_TABLE': DYNAMO_VIDEO_TASK_TABLE,
        'S3_PRESIGNED_URL_EXPIRY_S': S3_PRESIGNED_URL_EXPIRY_S,
        'NOVA_S3_VECTOR_BUCKET': S3_VECTOR_BUCKET_NOVA,
        'NOVA_S3_VECTOR_INDEX': S3_VECTOR_INDEX_NOVA,
        'S3_BUCKET_DATA': self.s3_bucket_name_mm,
        'MODEL_ID': MODEL_ID_BEDROCK_MME,
        'CLOUDFRONT_DOMAIN': 'd3qbit2yf1heat.cloudfront.net',
        'CLOUDFRONT_PRIVATE_KEY_SECRET': '/cloudfront/signing-key/private-key',
        'CLOUDFRONT_KEY_PAIR_ID': self.frontend_stack.cf_public_key.attr_id,
        'CLOUDFRONT_URL_EXPIRATION_MINUTES': '60',
    },
    layers=[self.boto3_layer, self.cloudfront_signing_layer]
)
```

---

## Step 5: Update Lambda Functions

### 5.1 Update `nova-srv-get-video-tasks.py`

File: `/Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/nova-srv-get-video-tasks/nova-srv-get-video-tasks.py`

**Add import at the top:**

```python
import cloudfront_signer
```

**Replace lines 73-104 with:**

```python
# Generate URL (CloudFront Signed URLs or S3 Presigned URLs)
cloudfront_domain = os.environ.get('CLOUDFRONT_DOMAIN', '')
url_expiration_minutes = int(os.environ.get('CLOUDFRONT_URL_EXPIRATION_MINUTES', '60'))

for r in result:
    s3_bucket = r.get("S3Bucket")
    s3_key = r.get("S3Key")
    if s3_bucket and s3_key:
        if cloudfront_domain:
            # Generate CloudFront Signed URL
            base_url = f"https://{cloudfront_domain}/{s3_key}"
            try:
                r["FileUrl"] = cloudfront_signer.generate_signed_url(
                    base_url,
                    expiration_minutes=url_expiration_minutes
                )
            except Exception as e:
                print(f"Error generating signed URL: {e}")
                # Fallback to S3 presigned URL
                r["FileUrl"] = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': s3_bucket, 'Key': s3_key},
                    ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                )
        else:
            # Fall back to S3 presigned URL
            r["FileUrl"] = s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': s3_bucket, 'Key': s3_key},
                ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
            )
        del r["S3Bucket"]
        del r["S3Key"]

    s3_bucket_thumbnail = r.get("S3BucketThumbnail")
    s3_key_thumbnail = r.get("S3KeyThumbnail")
    if s3_bucket_thumbnail and s3_key_thumbnail:
        if cloudfront_domain:
            base_url = f"https://{cloudfront_domain}/{s3_key_thumbnail}"
            try:
                r["ThumbnailUrl"] = cloudfront_signer.generate_signed_url(
                    base_url,
                    expiration_minutes=url_expiration_minutes
                )
            except Exception as e:
                print(f"Error generating signed thumbnail URL: {e}")
                r["ThumbnailUrl"] = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': s3_bucket_thumbnail, 'Key': s3_key_thumbnail},
                    ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                )
        else:
            r["ThumbnailUrl"] = s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': s3_bucket_thumbnail, 'Key': s3_key_thumbnail},
                ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
            )
        del r["S3BucketThumbnail"]
        del r["S3KeyThumbnail"]
```

### 5.2 Update `nova-srv-search-vector.py`

File: `/Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/source/nova_service/lambda/nova-srv-search-vector/nova-srv-search-vector.py`

**Add import at the top:**

```python
import cloudfront_signer
```

**Replace lines 89-106 with:**

```python
# Get file URL (CloudFront Signed URLs or S3 Presigned URLs)
cloudfront_domain = os.environ.get('CLOUDFRONT_DOMAIN', '')
url_expiration_minutes = int(os.environ.get('CLOUDFRONT_URL_EXPIRATION_MINUTES', '60'))

if include_video_url:
    for item in result:
        s3_bucket = item.get("S3Bucket")
        s3_key = item.get("S3Key")
        if s3_bucket and s3_key:
            if cloudfront_domain:
                # Generate CloudFront Signed URL
                base_url = f"https://{cloudfront_domain}/{s3_key}"
                try:
                    item["FileUrl"] = cloudfront_signer.generate_signed_url(
                        base_url,
                        expiration_minutes=url_expiration_minutes
                    )
                except Exception as e:
                    print(f"Error generating signed URL: {e}")
                    # Fallback to S3 presigned URL
                    item["FileUrl"] = s3.generate_presigned_url(
                        'get_object',
                        Params={'Bucket': s3_bucket, 'Key': s3_key},
                        ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                    )
            else:
                # Fall back to S3 presigned URL
                item["FileUrl"] = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': s3_bucket, 'Key': s3_key},
                    ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                )
```

---

## Step 6: Deploy CDK Stack

```bash
cd /Users/dohtem/Downloads/claude/sample-demo-of-nova-mme/sample-demo-of-nova-mme/deployment

# Activate virtual environment
source .venv/bin/activate

# Deploy all stacks
export CDK_INPUT_USER_EMAILS=your-email@example.com
export CDK_DEFAULT_ACCOUNT=your-aws-account-id
export CDK_DEFAULT_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1

cdk deploy --parameters inputUserEmails=your-email@example.com --requires-approval never --all
```

---

## Step 7: Upload Private Key to Secrets Manager

After CDK deployment completes:

```bash
aws secretsmanager put-secret-value \
  --secret-id /cloudfront/signing-key/private-key \
  --secret-string file://cloudfront_private_key.pem \
  --region us-east-1
```

Verify the secret was created:

```bash
aws secretsmanager describe-secret \
  --secret-id /cloudfront/signing-key/private-key \
  --region us-east-1
```

---

## Step 8: Invalidate CloudFront Cache

```bash
# Get CloudFront distribution ID
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='d3qbit2yf1heat.cloudfront.net'].Id" \
  --output text)

# Invalidate all cached unsigned URLs
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

---

## Step 9: Test Signed URLs

### 9.1 Test via API

```bash
# Login to get Cognito token (replace with your actual login flow)
# Then call the API

curl -X POST https://YOUR_API_GATEWAY_URL/nova-mme/search-task \
  -H "Authorization: Bearer YOUR_COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "SearchText": "",
    "PageSize": 10,
    "FromIndex": 0
  }'
```

The response should include signed URLs like:
```
https://d3qbit2yf1heat.cloudfront.net/tasks/xxx/video.mp4?Expires=...&Signature=...&Key-Pair-Id=...
```

### 9.2 Test URL Access

**Test with signed URL (should work):**
```bash
# Copy a signed URL from the API response
curl -I "https://d3qbit2yf1heat.cloudfront.net/tasks/xxx/video.mp4?Expires=...&Signature=...&Key-Pair-Id=..."
```

Expected: `HTTP/2 200`

**Test without signature (should fail):**
```bash
curl -I "https://d3qbit2yf1heat.cloudfront.net/tasks/xxx/video.mp4"
```

Expected: `HTTP/2 403 Forbidden`

### 9.3 Test in Browser

1. Log into your application at https://d3qbit2yf1heat.cloudfront.net/
2. Navigate to the video search page
3. Search for videos
4. Click on a video thumbnail
5. Verify video plays correctly

**Developer Tools Check:**
- Open browser Developer Tools > Network tab
- Look for video requests
- Verify URLs include `?Expires=...&Signature=...&Key-Pair-Id=...`
- Verify HTTP status is 200 (not 403)

---

## Troubleshooting

### Issue: 403 Forbidden on Signed URLs

**Possible causes:**
1. Private key not uploaded to Secrets Manager
2. CloudFront Key Pair ID mismatch
3. URL signature incorrect
4. URL expired (check expiration time)
5. CloudFront distribution not updated with key group

**Debug:**
```bash
# Check Secrets Manager
aws secretsmanager get-secret-value --secret-id /cloudfront/signing-key/private-key

# Check Lambda logs
aws logs tail /aws/lambda/nova-mme-nova-srv-get-video-tasks --follow

# Verify CloudFront distribution configuration
aws cloudfront get-distribution-config --id $DISTRIBUTION_ID | jq '.DistributionConfig.CacheBehaviors'
```

### Issue: Lambda timeout or memory errors

**Solution:** Increase Lambda memory or timeout in CDK:
```python
memory_m=256,  # Increase from 128
timeout_s=30,  # Increase from 10
```

### Issue: Cryptography library not found

**Solution:** Verify Lambda layer is attached:
```bash
aws lambda get-function --function-name nova-mme-nova-srv-get-video-tasks | jq '.Configuration.Layers'
```

---

## Security Best Practices

1. **Rotate Keys Regularly:** Set up automated key rotation (quarterly recommended)
2. **Monitor Access:** Enable CloudWatch Logs for Lambda and CloudFront
3. **Short Expiration:** Use 60-minute expiration for better security
4. **Restrict IP (Optional):** Add IP-based restrictions for sensitive content
5. **Audit Secrets Access:** Monitor Secrets Manager access logs in CloudTrail

---

## Performance Optimization

1. **Secrets Manager Caching:** Already implemented (1-hour cache TTL)
2. **Lambda Memory:** Increase to 256MB for faster cryptographic operations
3. **Lambda Warm-up:** Consider using provisioned concurrency for high-traffic periods
4. **CloudFront TTL:** Already optimized (24-48 hours cache)

---

## Cost Estimate

**Additional costs for signed URLs:**
- Secrets Manager: $0.40/month per secret
- Lambda Layer storage: ~$0.01/month
- Lambda execution: Minimal increase (~5-10ms per request)
- CloudFront key group: No additional cost

**Total additional cost:** ~$0.50/month

---

## Rollback Plan

If issues occur, quickly revert by removing the trusted key group:

```bash
# Update CloudFront distribution to remove trusted key groups
# Or simply unset the CLOUDFRONT_DOMAIN environment variable:

aws lambda update-function-configuration \
  --function-name nova-mme-nova-srv-get-video-tasks \
  --environment "Variables={DYNAMO_VIDEO_TASK_TABLE=nova_mme_nova_video_task,S3_PRE_SIGNED_URL_EXPIRY_S=3600}"

# This will fallback to S3 presigned URLs
```

---

## Summary

**What was implemented:**
- ✅ Secure key management with AWS Secrets Manager
- ✅ CloudFront Signed URLs with 60-minute expiration
- ✅ Secrets Manager caching for performance
- ✅ Automatic fallback to S3 presigned URLs on errors
- ✅ IAM least-privilege permissions

**Security benefits:**
- Only authenticated users can access media files
- Time-limited URL access (60 minutes)
- Private keys never exposed in code or environment variables
- Audit trail via CloudTrail

**Performance maintained:**
- CloudFront edge caching still active
- Minimal overhead (~5-10ms) for URL signing
- Secrets caching eliminates repeated API calls

---

## References

- [AWS CloudFront Signed URLs Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html)
- [AWS Secrets Manager Caching Library](https://github.com/aws/aws-secretsmanager-caching-python)
- [CloudFront Security Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/SecurityBestPractices.html)

---

**Document Version:** 1.0
**Last Updated:** 2025-11-13
**Author:** Claude Code Assistant
