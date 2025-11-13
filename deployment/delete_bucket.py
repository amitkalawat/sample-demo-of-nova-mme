#!/usr/bin/env python3
import boto3

import os

# Get account ID from environment variable
account_id = os.environ.get('CDK_DEFAULT_ACCOUNT')
region = os.environ.get('CDK_DEFAULT_REGION', 'us-east-1')
bucket_name = f'cdk-hnb659fds-assets-{account_id}-{region}'
region = 'us-east-1'

s3 = boto3.resource('s3', region_name=region)
bucket = s3.Bucket(bucket_name)

print(f"Deleting all versions and delete markers from {bucket_name}...")

# Delete all object versions and delete markers
bucket.object_versions.all().delete()

print(f"Deleting bucket {bucket_name}...")
bucket.delete()

print(f"Successfully deleted bucket {bucket_name}")
