#!/bin/bash

# Script to update Lambda functions with CloudFront domain for video delivery optimization
# Run this after deployment to enable CloudFront URLs instead of S3 pre-signed URLs

set -e

echo "Fetching CloudFront domain from SSM Parameter..."
CLOUDFRONT_DOMAIN=$(aws ssm get-parameter --name "/nova-mme/cloudfront-domain" --region us-east-1 --query 'Parameter.Value' --output text)

if [ -z "$CLOUDFRONT_DOMAIN" ]; then
    echo "Error: CloudFront domain not found in SSM Parameter Store"
    exit 1
fi

echo "CloudFront Domain: $CLOUDFRONT_DOMAIN"
echo ""

# List of Lambda functions to update
LAMBDA_FUNCTIONS=(
    "nova-mme-nova-srv-search-vector"
    "nova-mme-nova-srv-search-vector-rag"
    "nova-mme-nova-srv-get-video-tasks"
)

echo "Updating Lambda functions with CLOUDFRONT_DOMAIN environment variable..."
echo ""

for FUNCTION_NAME in "${LAMBDA_FUNCTIONS[@]}"; do
    echo "Updating $FUNCTION_NAME..."

    # Get current environment variables
    CURRENT_ENV=$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" --region us-east-1 --query 'Environment.Variables' --output json)

    # Add CLOUDFRONT_DOMAIN to environment variables (compact JSON output)
    UPDATED_ENV=$(echo "$CURRENT_ENV" | jq -c --arg domain "$CLOUDFRONT_DOMAIN" '. + {CLOUDFRONT_DOMAIN: $domain}')

    # Update Lambda function (pass JSON as string)
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --region us-east-1 \
        --environment "Variables=$UPDATED_ENV" \
        --output json > /dev/null

    echo "  ✓ Updated $FUNCTION_NAME"
done

echo ""
echo "✓ All Lambda functions updated successfully!"
echo ""
echo "Videos will now be served via CloudFront for improved performance."
echo "Expected improvement: 40-60% faster video playback"
