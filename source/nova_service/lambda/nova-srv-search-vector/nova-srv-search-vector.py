'''
"Source": mm_embedding | text_embedding | text,
'''
import json
import boto3
import os
import re
from urllib.parse import urlparse
import utils
import uuid
import time
import base64

S3_PRESIGNED_URL_EXPIRY_S = os.environ.get("S3_PRESIGNED_URL_EXPIRY_S", 3600) # Default 1 hour 
S3_BUCKET_DATA = os.environ.get("S3_BUCKET_DATA")

DYNAMO_VIDEO_TASK_TABLE = os.environ.get("DYNAMO_VIDEO_TASK_TABLE")
MODEL_ID = os.environ.get("MODEL_ID")
NOVA_S3_VECTOR_BUCKET = os.environ.get("NOVA_S3_VECTOR_BUCKET")
NOVA_S3_VECTOR_INDEX = os.environ.get("NOVA_S3_VECTOR_INDEX")
EMBEDDING_DIM = os.environ.get("EMBEDDING_DIM")

EMBEDDING_DIM = int(EMBEDDING_DIM) if EMBEDDING_DIM else 1024

s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime')
s3vectors = boto3.client('s3vectors') 

def lambda_handler(event, context):
    search_text = event.get("SearchText", "")
    page_size = event.get("PageSize", 10)
    from_index = event.get("FromIndex", 0)
    request_by = event.get("RequestBy")
    input_bytes = event.get("InputBytes", "")
    input_format = event.get("InputFormat", "")
    source = event.get("Source")
    input_type = event.get("InputType")
    TOP_K = event.get("TopK", 5)
    include_video_url = event.get("IncludeFileUrl", True)

    embedding_options = event.get("EmbeddingOptions")
    if not embedding_options:
        embedding_options = ["text", "image", "audio-video", "video", "audio"]

    if search_text is None:
        search_text = ""
    if input_bytes is None:
        input_bytes = ""
    if len(search_text) > 0:
        search_text = search_text.strip()
    
    # Get Tasks by RequestBy
    if search_text or input_bytes:
        input_embedding = None
        #s3_prefix_output = f'tasks/tlabs/search/{uuid.uuid4()}/'
        input_embedding = embed_input(input_type, search_text, input_bytes, input_format)
        if not input_embedding:
            return {
                'statusCode': 500,
                'body': 'Failed to generate input embedding'
            }
        clips = search_embedding_s3vectors(input_embedding, NOVA_S3_VECTOR_BUCKET, NOVA_S3_VECTOR_INDEX, TOP_K, embedding_options)
            
        result = []
        if clips:
            for clip in clips:
                # Try to get task_id from metadata first
                task_id = clip.get("metadata",{}).get("task_id")
                
                # Fallback: extract task_id from vector key if metadata is empty
                # Key format: {task_id}_{type}_{index}
                if not task_id and clip.get("key"):
                    key_parts = clip["key"].split("_")
                    if len(key_parts) >= 3:
                        # Task ID is a UUID, reconstruct it from first 5 parts
                        task_id = "-".join(key_parts[0:5])
                
                if task_id:
                    task = utils.dynamodb_get_by_id(DYNAMO_VIDEO_TASK_TABLE, task_id, "Id")
                    if task:
                        item = construct_output(clip, task)
                        result.append(item)    
                
    # Pagination
    from_index = from_index if from_index > 0 else 0
    end_index = from_index + page_size if from_index + page_size < len(result) else len(result)
    result = result[from_index: end_index]

    # Get file URL (CloudFront or S3 presigned URL)
    cloudfront_domain = os.environ.get('CLOUDFRONT_DOMAIN', '')
    if include_video_url:
        for item in result:
            s3_bucket = item.get("S3Bucket")
            s3_key = item.get("S3Key")
            if s3_bucket and s3_key:
                if cloudfront_domain:
                    # Use CloudFront URL for better performance
                    item["FileUrl"] = f"https://{cloudfront_domain}/{s3_key}"
                else:
                    # Fall back to S3 presigned URL
                    item["FileUrl"] = s3.generate_presigned_url(
                            'get_object',
                            Params={'Bucket': s3_bucket, 'Key': s3_key},
                            ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                        )

    return {
        'statusCode': 200,
        'body': result
    }

def embed_input(input_type, input_text, input_bytes, input_format, model_id=MODEL_ID):
    request_body = None
    if input_type == "text":
        request_body = {
            "schemaVersion": "nova-multimodal-embed-v1",
            "taskType": "SINGLE_EMBEDDING",
            "singleEmbeddingParams": {
                "embeddingPurpose": "GENERIC_RETRIEVAL",
                "embeddingDimension": EMBEDDING_DIM,
                "text": {
                    "truncationMode": "NONE",
                    "value": input_text,
                }
            }
        }

    elif input_type == "image" and input_bytes:
        request_body = {
            "schemaVersion": "nova-multimodal-embed-v1",
            "taskType": "SINGLE_EMBEDDING",
            "singleEmbeddingParams": {
                "embeddingPurpose": "GENERIC_RETRIEVAL",
                "embeddingDimension": EMBEDDING_DIM,
                "image": {
                    "detailLevel": "DOCUMENT_IMAGE",
                    "format": input_format,
                    "source": {"bytes": input_bytes},
                }
            }
        }



    # Invoke the Nova Embeddings model.
    response = bedrock.invoke_model(
        body=json.dumps(request_body),
        modelId=model_id,
        accept="application/json",
        contentType="application/json",
    )

    # Decode the response body.
    response_body = json.loads(response.get("body").read())
    response_metadata = response["ResponseMetadata"]
    return response_body["embeddings"][0]["embedding"]

def search_embedding_s3vectors(input_embedding, s3vector_bucket, s3vector_index, top_k, embedding_options):
    # Query vector index.
    response = s3vectors.query_vectors(
        vectorBucketName=s3vector_bucket,
        indexName=s3vector_index,
        queryVector={"float32": input_embedding}, 
        topK=top_k, 
        returnDistance=True,
        returnMetadata=True,
        filter={"embeddingOption": {"$in": embedding_options}}
    )

    return response["vectors"]

TEXT_CONTENT = {}
def construct_output(clip, task):
    modality = task.get("Modality")
    task_id = clip.get("metadata",{}).get("task_id")
    
    # Fallback: extract task_id from key if not in metadata
    if not task_id and clip.get("key"):
        key_parts = clip["key"].split("_")
        if len(key_parts) >= 5:
            task_id = "-".join(key_parts[0:5])
    
    # Extract embedding type from key if not in metadata
    embedding_option = clip.get("metadata",{}).get("embeddingOption")
    if not embedding_option and clip.get("key"):
        key_parts = clip["key"].split("_")
        if len(key_parts) >= 6:
            embedding_option = key_parts[5]  # e.g., "audio", "video", "image", "text"

    item = {
                "TaskId": task_id,
                "TaskName": task["Request"].get("FileName"),
                "FileName": task["Request"]["FileName"],
                "Modality": modality,
                "RequestTs": task["RequestTs"],
                "Status": task["Status"],
                "S3Bucket": task.get("Request",{}).get("File",{}).get("S3Object",{}).get("Bucket"),
                "S3Key": task.get("Request",{}).get("File",{}).get("S3Object",{}).get("Key"),
                "EmbeddingOption": embedding_option,
                "Distance": clip["distance"],
            }
    if modality in ["video","audio"]:
        item["StartSec"] = clip.get("metadata",{}).get("startSec", 0)
        item["EndSec"] = clip.get("metadata",{}).get("endSec", 30)
    elif modality in ["image"]:
        # no additional field
        pass
    elif modality in ["text"]:
        segmentStartCharPosition = int(clip["metadata"]["segmentStartCharPosition"])
        segmentIndex = int(clip["metadata"]["segmentIndex"])
        segmentEndCharPosition = int(clip["metadata"]["segmentEndCharPosition"])

        text_content = None

        # Get file content from S3 and store to variable 
        txt_file_key = f"txt_{task_id}_{segmentIndex}"
        if txt_file_key in TEXT_CONTENT:
            text_content = TEXT_CONTENT[txt_file_key]
        else:
            response = s3.get_object(Bucket=item["S3Bucket"], Key=item["S3Key"])
            text_content = response["Body"].read().decode("utf-8")
            TEXT_CONTENT[txt_file_key] = text_content

        item["StartCharPosition"] = segmentStartCharPosition
        item["EndCharPosition"] = segmentEndCharPosition
        item["Index"] = segmentIndex
        item["Citation"] = text_content[segmentStartCharPosition:segmentEndCharPosition]
    
    return item
        