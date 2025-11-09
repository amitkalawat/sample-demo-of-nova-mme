import json
import boto3
import uuid
import utils
import os
import botocore
from datetime import datetime, timezone

DYNAMO_VIDEO_TASK_TABLE = os.environ.get("DYNAMO_VIDEO_TASK_TABLE")
LAMBDA_FUN_NAME_VIDEO_METADATA = os.environ.get("LAMBDA_FUN_NAME_VIDEO_METADATA")
EMBEDDING_DIM = os.environ.get("EMBEDDING_DIM")
MODEL_ID = 'amazon.nova-2-multimodal-embeddings-v1:0'

EMBEDDING_DIM = int(EMBEDDING_DIM) if EMBEDDING_DIM else 1024

MEDIA_TYPE_MAPPING = {
    "text": ["txt"],
    "image": ["png", "jpeg", "gif", "webp"],
    "audio": ["mp3", "wav", "ogg"],
    "video": ["mp4", "mov", "mkv", "webm", "flv", "mpeg", "mpg", "wmv", "3gp"],
}

bedrock = boto3.client('bedrock-runtime')
lambda_client = boto3.client('lambda')
s3 = boto3.client("s3")

def lambda_handler(event, context):
    if event is None \
            or "File" not in event \
            or "S3Object" not in event["File"]:
        return {
            'statusCode': 400,
            'body': 'Invalid request'
        }
    
    # Get task Id. Create a new one if not provided.
    task_id = event.get("TaskId")
    if not task_id:
        return {
            'statusCode': 400,
            'body': 'Invalid request'
        }
    
    extra_option = event.get("TaskType", "frame")

    # Store to DB
    doc = {
        "Id": task_id,
        "Request": event,
        "RequestTs": datetime.now(timezone.utc).isoformat(),
        "RequestBy": event.get("RequestBy", "unknown"),
        "Name": event.get("Name", event.get("FileName")),
        "MetaData": {
            "TrasnscriptionOutput": None
        }
    }

    s3_bucket = event.get("File",{}).get("S3Object").get("Bucket")
    s3_key = event.get("File",{}).get("S3Object").get("Key")
    s3_prefix_output = f'tasks/{task_id}/nova-mme/'
    model_id = event.get("ModelId",MODEL_ID)

    # temp workaround before Nova fix output support prefix
    # Create output folder if not exists
    tmp_key = s3_prefix_output + ".tmp"
    try:
        # Check if placeholder exists
        s3.head_object(Bucket=s3_bucket, Key=tmp_key)
        print(f"Folder already exists: s3://{s3_bucket}/{tmp_key}")
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            # Create placeholder file
            s3.put_object(Bucket=s3_bucket, Key=tmp_key, Body=b"")
            print(f"Created folder: s3://{s3_bucket}/{tmp_key}")
    
    file_ext, media_type = get_media_type_from_s3_key(s3_key)
    request = construct_request(file_ext, media_type, s3_bucket, s3_key, event)
    if not request:
        return {
            'statusCode': 500,
            'body': 'Failed to start embedding task'
        }

    # Start Nova MME async task
    response = bedrock.start_async_invoke(
        modelId=model_id,
        modelInput=request,
        outputDataConfig={
            "s3OutputDataConfig": {
                "s3Uri": f's3://{s3_bucket}/{s3_prefix_output}'
            }
        }
    )
    print("Task arn:", response["invocationArn"])

    # Start video metadata task
    if media_type == "video":
        response = lambda_client.invoke(
            FunctionName=LAMBDA_FUN_NAME_VIDEO_METADATA,
            InvocationType='Event',  # Asynchronous invocation
            Payload=json.dumps({"Request": event})
        )

    doc["Modality"] = media_type
    doc["Status"] = "processing"

    # Update DB
    response = utils.dynamodb_table_upsert(DYNAMO_VIDEO_TASK_TABLE, doc)
        
    return {
        'statusCode': 200,
        'body': {
            "TaskId": task_id
        }
    }

def construct_request(file_ext, media_type, s3_bucket, s3_key, event):
    request = None

    if media_type == "text":
        truncation_mode = event.get("TruncateMode", "START")
        max_length_chars = int(event.get("MaxLengthChars", 800))
        request = {
            "taskType": "SEGMENTED_EMBEDDING",
            "segmentedEmbeddingParams": {
                "embeddingDimension": EMBEDDING_DIM,
                "embeddingPurpose": "GENERIC_INDEX",
                "text": {
                    #"value": string,
                    "source": {
                        "s3Location": {
                            "uri": f's3://{s3_bucket}/{s3_key}',
                        }
                    },
                    "segmentationConfig": {
                        "truncationMode": truncation_mode,
                        "maxLengthChars": max_length_chars
                    }
                },
            },
        }
    elif media_type == "video":
        embed_mode = event.get("EmbedMode", "AUDIO_VIDEO_COMBINED")
        duration_s = int(event.get("DurationS", 5))

        request = {
            "taskType": "SEGMENTED_EMBEDDING",
            "segmentedEmbeddingParams": {
                "embeddingDimension": EMBEDDING_DIM,
                "embeddingPurpose": "GENERIC_INDEX",
                "video": {
                    "format": file_ext,
                    "embeddingMode": embed_mode,
                    "source": {
                        "s3Location": {
                            "uri": f's3://{s3_bucket}/{s3_key}',
                        }
                    },
                    "segmentationConfig": {"durationSeconds": duration_s},
                },
            },
        }
    elif media_type == "image":
        detail_level = event.get("DetailLevel", "STANDARD_IMAGE")
        request = {
            "schemaVersion": "nova-multimodal-embed-v1",
            "taskType": "SEGMENTED_EMBEDDING",
            "segmentedEmbeddingParams": {
                "embeddingPurpose": "GENERIC_INDEX",
                "embeddingDimension": EMBEDDING_DIM,
                "image": {
                    "format": file_ext,
                    "detailLevel": detail_level,
                    "source": {
                        "s3Location": {
                            "uri": f's3://{s3_bucket}/{s3_key}',
                        }
                    }
                },
            },
        }
    elif media_type == "audio":
        duration_s = int(event.get("DurationS", 5))
        request = {
                "schemaVersion": "nova-multimodal-embed-v1",
                "taskType": "SEGMENTED_EMBEDDING",
                "segmentedEmbeddingParams": {
                    "embeddingPurpose": "GENERIC_INDEX",
                    "embeddingDimension": EMBEDDING_DIM,
                    "audio": {
                        "format": "mp3",
                        "source": {
                            "s3Location": {
                            "uri": f's3://{s3_bucket}/{s3_key}',
                        }
                        },
                        "segmentationConfig": {
                            "durationSeconds": duration_s
                        }
                    }
                }
            }
    
    return request

def get_media_type_from_s3_key(s3_key: str) -> str | None:
    """
    Determines the media type (text, image, audio, or video)
    based on the file extension from the provided S3 key.
    Returns None if the extension is not recognized.
    """
    ext = os.path.splitext(s3_key)[1].lower().lstrip('.')  # Extract file extension

    for media_type, extensions in MEDIA_TYPE_MAPPING.items():
        if ext in extensions:
            return ext, media_type
    return ext, None