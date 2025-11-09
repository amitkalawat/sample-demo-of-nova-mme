'''
"Source": mm_embedding | text_embedding | text,
'''
import json
import boto3
import os
import utils
import re
from urllib.parse import urlparse

DYNAMO_VIDEO_TASK_TABLE = os.environ.get("DYNAMO_VIDEO_TASK_TABLE")
DYNAMO_VIDEO_FRAME_TABLE = os.environ.get("DYNAMO_VIDEO_FRAME_TABLE")
DYNAMO_VIDEO_TRANS_TABLE = os.environ.get("DYNAMO_VIDEO_FRAME_TABLE")

S3_PRESIGNED_URL_EXPIRY_S = os.environ.get("S3_PRESIGNED_URL_EXPIRY_S", 3600) # Default 1 hour 

s3 = boto3.client('s3')

def lambda_handler(event, context):
    search_text = event.get("SearchText", "")
    page_size = event.get("PageSize", 10)
    from_index = event.get("FromIndex", 0)
    request_by = event.get("RequestBy")
    source = event.get("Source")
    task_type = event.get("TaskType")
    
    if search_text is None:
        search_text = ""
    if len(search_text) > 0:
        search_text = search_text.strip()

    tasks = utils.scan_task_with_pagination(DYNAMO_VIDEO_TASK_TABLE, keyword=search_text, start_index=0, page_size=1000)
    #return tasks
    result = []
    if tasks:
        for task in tasks:
            task_id = task["Id"]
            modality = task.get("Modality")
            r = {
                    "TaskId": task_id,
                    "FileName": task["Request"]["FileName"],
                    "TaskName": task["Request"].get("TaskName"),
                    "Name": task["Request"].get("Name",task["Request"]["FileName"]),
                    "Modality": modality,
                    "RequestTs": task["RequestTs"],
                    "Status": task["Status"],
                    "RequestBy": task.get("RequestBy"),
                    "EmbedCompleteTs": task.get("EmbedCompleteTs")
                }
            
            s3_bucket = task.get("Request",{}).get("File", {}).get("S3Object",{}).get("Bucket")
            s3_key = task.get("Request",{}).get("File", {}).get("S3Object",{}).get("Key")
            if modality in ["image","audio","video","text"]:
                r["S3Bucket"] = s3_bucket
                r["S3Key"] = s3_key
            if modality == "video":
                r["S3BucketThumbnail"] = s3_bucket
                path = "/".join(s3_key.split("/")[0:-1])
                r["S3KeyThumbnail"] = f"{path}/thumbnail.jpeg"

            result.append(r)

    # Sort by RequestTs
    result = sorted(result, key=lambda x: x.get("RequestTs"), reverse=True)

    # Pagination
    end_index = from_index + page_size
    if end_index > len(result):
        end_index = len(result)

    result = result[from_index:end_index]

    # Generate URL
    for r in result:
        s3_bucket = r.get("S3Bucket")
        s3_key = r.get("S3Key")
        if s3_bucket and s3_key:
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
            r["ThumbnailUrl"] = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': s3_bucket_thumbnail, 'Key': s3_key_thumbnail},
                    ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                )
            del r["S3BucketThumbnail"]
            del r["S3KeyThumbnail"]

    return {
        'statusCode': 200,
        'body': result
    }
