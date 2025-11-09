import json
import boto3
import os
import utils
import uuid

# ==== Environment Variables ====
S3_PRESIGNED_URL_EXPIRY_S = int(os.environ.get("S3_PRESIGNED_URL_EXPIRY_S", 3600))
S3_BUCKET_DATA = os.environ.get("S3_BUCKET_DATA")
DYNAMO_VIDEO_TASK_TABLE = os.environ.get("DYNAMO_VIDEO_TASK_TABLE")
MODEL_ID_EMBED = os.environ.get("MODEL_ID_EMBED")
MODEL_ID_LLM = os.environ.get("MODEL_ID_LLM") 
NOVA_S3_VECTOR_BUCKET = os.environ.get("NOVA_S3_VECTOR_BUCKET")
NOVA_S3_VECTOR_INDEX = os.environ.get("NOVA_S3_VECTOR_INDEX")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", 1024))

# ==== Clients ====
s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime')
s3vectors = boto3.client('s3vectors')

# ==== Main Handler ====
def lambda_handler(event, context):
    """
    Expected Input:
    {
        "ChatHistory": [
            {"role": "user", "content": "Find videos about summer fashion"},
            {"role": "assistant", "content": "Sure, what kind of fashion?"}
        ],
        "RequestBy": "user@example.com",
        "TopK": 5
    }
    """

    chat_history = event.get("ChatHistory", [])
    request_by = event.get("RequestBy")
    top_k = event.get("TopK", 5)

    # Get the latest user message
    user_message = ""
    if chat_history and chat_history[-1]["role"] == "user":
        user_message = chat_history[-1]["content"]
    else:
        return {"statusCode": 400, "body": "No valid user message found."}

    # Get embedding for the user query
    input_embedding = embed_text(user_message[0].get("text"))
    if not input_embedding:
        return {"statusCode": 500, "body": "Failed to create embedding for query."}

    # Search the vector DB for similar items
    results = search_embedding_s3vectors(input_embedding, NOVA_S3_VECTOR_BUCKET, NOVA_S3_VECTOR_INDEX, top_k)

    # Construct text-based context for the LLM
    citations = []
    text_citation = ""
    for r in results:
        task_id = r.get("metadata", {}).get("task_id")
        task = utils.dynamodb_get_by_id(DYNAMO_VIDEO_TASK_TABLE, task_id, "Id")    
        if task:
            citation = construct_citation(r, task)
            if citation:
                citations.append(citation)
                if citation.get("TextCitation"):
                    text_citation += f"; {citation.get("TextCitation")}"


    # Generate final chat response from LLM
    llm_response = generate_chat_response(chat_history, text_citation)

    return {
        "statusCode": 200,
        "body": {
            "reply": llm_response,
            "citations": citations,
        }
    }


# ==== Embedding Function ====
def embed_text(text, model_id=MODEL_ID_EMBED):
    request_body = {
        "schemaVersion": "nova-multimodal-embed-v1",
        "taskType": "SINGLE_EMBEDDING",
        "singleEmbeddingParams": {
            "embeddingPurpose": "GENERIC_RETRIEVAL",
            "embeddingDimension": EMBEDDING_DIM,
            "text": {
                "truncationMode": "NONE",
                "value": text,
            }
        }
    }

    response = bedrock.invoke_model(
        body=json.dumps(request_body),
        modelId=model_id,
        accept="application/json",
        contentType="application/json",
    )
    response_body = json.loads(response.get("body").read())
    return response_body["embeddings"][0]["embedding"]


# ==== Vector Search ====
def search_embedding_s3vectors(input_embedding, s3vector_bucket, s3vector_index, top_k):
    response = s3vectors.query_vectors(
        vectorBucketName=s3vector_bucket,
        indexName=s3vector_index,
        queryVector={"float32": input_embedding},
        topK=top_k,
        returnDistance=True,
        returnMetadata=True
    )
    return response["vectors"]


# ==== Construct Text Context ====
def construct_citation(clip, task):
    modality = task.get("Modality", "unknown")
    file_name = task.get("Request", {}).get("FileName", "")
    text_citation = ""

    s3_bucket = task["Request"]["File"]["S3Object"]["Bucket"]
    s3_key = task["Request"]["File"]["S3Object"]["Key"]
    task_name = task["Request"]["TaskName"]

    startCharPos, endCharPos = None, None
    startSec, endSec, index = None, None, None
    s3_url = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': s3_bucket, 'Key': s3_key},
                    ExpiresIn=S3_PRESIGNED_URL_EXPIRY_S
                )
    if modality == "text":
        response = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        text_content = response["Body"].read().decode("utf-8")
        startCharPos = int(clip["metadata"].get("segmentStartCharPosition", 0))
        endCharPos = int(clip["metadata"].get("segmentEndCharPosition", 200))
        text_citation = text_content[startCharPos:endCharPos]
        index = int(clip["metadata"].get("segmentIndex", 0))
    elif modality in ["image", "video", "audio"]:
        text_citation = f"[{modality.upper()}]: {file_name}"
        startSec = int(clip["metadata"].get("startSec", 0))
        endSec = int(clip["metadata"].get("endSec", 0))

    return {
        "Modality": modality,
        "Distance": clip.get('distance', 0),
        "S3Bucket": s3_bucket,
        "S3Key": s3_key,
        "TaskName": task_name,
        "TextCitation": text_citation,
        "TextIndex": index,
        "StartCharPosition": startCharPos,
        "EndCharPosition": endCharPos,
        "StartSec": startSec,
        "EndSec": endSec,
        "FileUrl": s3_url
    }


# ==== LLM Generation ====
def generate_chat_response(chat_history, context_text):
    """
    Use Bedrock LLM (Claude / Nova) to respond conversationally,
    using the provided context.
    """

    system_prompt = """You are a helpful AI assistant that provides concise answers related to multimodal data in your database. 
        For video, audio and text files, say 'Found the following relevant results'. 
        Generate answer based on the citation only without involving previous conversation context and keep the response within 100 tokens."""

    # Convert chat history into a prompt
    chat_history.append({
            "role": "user",
            "content": [
                {"text": f"Relevant context:\n{context_text}"},
            ]
        })

    response = bedrock.converse(
                modelId=MODEL_ID_LLM,
                messages=chat_history,
                system=[{"text": system_prompt}],
                inferenceConfig= {
                    "maxTokens": 500,
                    "topP": 0.1,
                    "temperature": 0.7
                },
            )
    txt_result = None
    contents = response.get("output", {}).get("message", {}).get("content", [])
    for c in contents:
        if "toolUse" in c:
            tool_use = c["toolUse"].get("input")
        elif "text" in c:
            txt_result = c["text"]

    return txt_result