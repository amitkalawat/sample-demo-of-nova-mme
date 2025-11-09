'''
1. Read Transcribe transcription and subtitle from s3
2. Update DB
3. Start extraction step functions workflow
'''
import json
import boto3
import os
import utils
import re
from datetime import datetime, timezone

DYNAMO_VIDEO_TASK_TABLE = os.environ.get("DYNAMO_VIDEO_TASK_TABLE")
NOVA_S3_VECTOR_BUCKET = os.environ.get("NOVA_S3_VECTOR_BUCKET")
NOVA_S3_VECTOR_INDEX = os.environ.get("NOVA_S3_VECTOR_INDEX")

s3 = boto3.client('s3')
s3vectors = boto3.client('s3vectors') 

def lambda_handler(event, context):
    print(json.dumps(event))
    if event is None or "Records" not in event or len(event["Records"]) == 0:
        return {
            'statusCode': 400,
            'body': 'Invalid trigger'
        }
    s3_bucket, s3_key, task_id = None, None, None
    try:
        s3_bucket = event["Records"][0]["s3"]["bucket"]["name"]
        s3_key = event["Records"][0]["s3"]["object"]["key"]
        task_id = s3_key.split('/')[1]
    except ex as Exception:
        print(ex)
        return {
            'statusCode': 400,
            'body': f'Error parsing S3 trigger: {ex}'
        }
    
    # Ignore key path contains /search/ trigger - they are managed differently by the search process
    if '/nova-mme/search/' in s3_key:
        return {
            'statusCode': 400,
            'body': 'Search trigger. Ignored.'
        }

    
    if not s3_bucket or not s3_key or not task_id:
        return {
            'statusCode': 400,
            'body': 'Invalid trigger'
        }

    # Get embedding result from S3
    obj = s3.get_object(Bucket=s3_bucket, Key=s3_key)
    content = obj['Body'].read().decode('utf-8')
    #output = json.loads(content).get("data")

    data = []
    embed_name = s3_key.split('/')[-1].replace(".jsonl","").replace("embedding-","")
    if s3_key:
        obj = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        content = obj['Body'].read().decode('utf-8')
        for item in content.split('\n'):
            if item:
                embed = json.loads(item)
                if "segmentMetadata" in embed:
                    embed["segmentMetadata"]["type"] = embed_name
                data.append(embed)


    # Add embeddings to S3 Vector: batch size 100
    embeddings, batch_size, counter = [], 200, 0
    for item in data:
        embed = construct_embed(task_id, item, embed_name)
        if embed:
            embeddings.append(embed)

        counter += 1
        if len(embeddings) >= batch_size or counter >= len(data):
            # Write embeddings into vector index with metadata.
            s3vectors.put_vectors(
                vectorBucketName=NOVA_S3_VECTOR_BUCKET,   
                indexName=NOVA_S3_VECTOR_INDEX,   
                vectors=embeddings
            )
            embeddings = []


    # Update DynamoDB task status
    doc = None
    try:
        doc = utils.dynamodb_get_by_id(DYNAMO_VIDEO_TASK_TABLE, id=task_id)
        if doc is not None:
            # Update video task status
            doc["Status"] = "completed"
            doc["EmbedCompleteTs"] = datetime.now(timezone.utc).isoformat()
            doc["Id"] = task_id
        
            # update DB: video_task
            utils.dynamodb_table_upsert(DYNAMO_VIDEO_TASK_TABLE, doc)
    except Exception as ex:
        print('Doc does not exist',ex)
    

    return {
        'statusCode': 200,
        'body': 'Task completed.'
    }

def construct_embed(task_id, item, embed_name):
    result = None
    if embed_name in ["audio-video", "video", "audio"]:
        result = {
                    "key": f'{task_id}_{item["segmentMetadata"]["type"]}_{item["segmentMetadata"]["segmentIndex"]}',
                    "data": {"float32": item["embedding"]},
                    "metadata": {
                        "task_id": task_id, 
                        "embeddingOption": item["segmentMetadata"]["type"], 
                        "startSec": item["segmentMetadata"]["segmentStartSeconds"], 
                        "endSec": item["segmentMetadata"]["segmentEndSeconds"]
                    }
                }
    elif embed_name in ["image"]:
        result = {
                    "key": f'{task_id}_{embed_name}',
                    "data": {"float32": item["embedding"]},
                    "metadata": {
                        "task_id": task_id, 
                        "embeddingOption": embed_name, 
                    }
                }
    elif embed_name in ["text"]:
        #"segmentMetadata":{"segmentIndex":0,"truncatedCharLength":0,"segmentStartCharPosition":0,"segmentEndCharPosition":794}
        seg_metadata = item.get("segmentMetadata",{})
        result = {
                    "key": f'{task_id}_{embed_name}_{seg_metadata.get("segmentIndex")}',
                    "data": {"float32": item["embedding"]},
                    "metadata": {
                        "task_id": task_id, 
                        "embeddingOption": embed_name, 
                        "segmentIndex": seg_metadata.get("segmentIndex"),
                        "truncatedCharLength":seg_metadata.get("truncatedCharLength"),
                        "segmentStartCharPosition":seg_metadata.get("segmentStartCharPosition"),
                        "segmentEndCharPosition":seg_metadata.get("segmentEndCharPosition")
                    }
                }
    return result