import os
from aws_cdk import (
    aws_iam as _iam,
    aws_s3 as _s3,
    aws_s3_deployment as _s3_deployment,
    aws_cloudfront as _cloudfront,
    aws_cloudfront_origins as _origins,
    aws_lambda as _lambda,
    aws_cloudformation as _cfn,
    aws_ssm as _ssm,
    CfnOutput,
    RemovalPolicy,
    Duration,
    custom_resources as cr,
    NestedStack,
    aws_codebuild as codebuild,
    aws_s3_assets as s3_assets,
)
from aws_cdk.aws_logs import RetentionDays
from constructs import Construct
from frontend.constant import *


class FrontendStack(NestedStack):
    region = None
    account_id = None
    api_gw_base_url_nova_srv = None
    cognito_user_pool_id = None
    cognito_app_client_id = None
    cognito_identity_pool_id = None

    s3_bucket_name_data = None
    
    output_url = ""

    def __init__(self, scope: Construct, construct_id: str, 
            api_gw_base_url_nova_srv, 
            cognito_user_pool_id, 
            cognito_app_client_id, 
            cognito_identity_pool_id,
            s3_bucket_name_data,
            **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.account_id=os.environ.get("CDK_DEFAULT_ACCOUNT")
        self.region=os.environ.get("CDK_DEFAULT_REGION")
        
        self.api_gw_base_url_nova_srv = api_gw_base_url_nova_srv
        self.cognito_user_pool_id = cognito_user_pool_id
        self.cognito_app_client_id = cognito_app_client_id
        self.cognito_identity_pool_id = cognito_identity_pool_id

        self.s3_bucket_name_data = s3_bucket_name_data

        self.deploy_s3() # Web and log buckets
        self.deploy_codebuild() # Build REACT code and deploy to the web bucket
        self.deploy_cloudfront() # Deploy CloudFront distribution

    def deploy_s3(self):
        # Create log bucket
        self.web_log_bucket = _s3.Bucket(
            self,
            id="FronendLogBucket",
            bucket_name=f'{S3_BUCKET_NAME_PREFIX}-log-{self.account_id}-{self.region}',
            object_ownership=_s3.ObjectOwnership.OBJECT_WRITER,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            enforce_ssl=True,
            access_control=_s3.BucketAccessControl.PRIVATE,
        )

        # Create web bucket
        self.web_bucket = _s3.Bucket(
            self,
            id="FronendWebBucket",
            bucket_name=f'{S3_BUCKET_NAME_PREFIX}-web-{self.account_id}-{self.region}',
            access_control=_s3.BucketAccessControl.PRIVATE,
            website_index_document="index.html",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            server_access_logs_prefix="access-log/",
            enforce_ssl=True
        )

        # Output s3 web bucket name
        self.s3_web_bucket_name = self.web_bucket.bucket_name
        
    def deploy_codebuild(self):
        # Package the local React app source as an asset
        source_asset = s3_assets.Asset(
            self,
            "FrontendReactSourceCode",
            path="../source/frontend/web",   # <-- local React project folder
            exclude=["build/*", "node_modules/*",".env"]

        )

        # Use data bucket as the staging bucket to store build
        staging_bucket = _s3.Bucket.from_bucket_name(self, "StagingBucket", bucket_name=self.s3_bucket_name_data)

        # CodeBuild project with environment variables
        project = codebuild.Project(
            self,
            "nova-mme-frontend-app-build",
            source=codebuild.Source.s3(
                bucket=source_asset.bucket,
                path=source_asset.s3_object_key,
            ),
            environment=codebuild.BuildEnvironment(
                build_image=codebuild.LinuxBuildImage.STANDARD_7_0,  # Node.js 18
                privileged=True,
                environment_variables={
                    "REACT_APP_COGNITO_USER_POOL_ID": codebuild.BuildEnvironmentVariable(value=self.cognito_user_pool_id),
                    "REACT_APP_COGNITO_USER_POOL_CLIENT_ID": codebuild.BuildEnvironmentVariable(value=self.cognito_app_client_id),
                    "REACT_APP_APIGATEWAY_BASE_URL_NOVA_SRV": codebuild.BuildEnvironmentVariable(value=self.api_gw_base_url_nova_srv),
                    "REACT_APP_READONLY_DISPLAY_MENUS": codebuild.BuildEnvironmentVariable(value=FRONT_END_DISPLAY_MENUS),
                    "REACT_APP_COGNITO_IDENTITY_POOL_ID": codebuild.BuildEnvironmentVariable(value=self.cognito_identity_pool_id),
                    "REACT_APP_COGNITO_REGION": codebuild.BuildEnvironmentVariable(value=self.region),
                }
            ),
            artifacts=codebuild.Artifacts.s3(
                bucket=staging_bucket,
                include_build_id=False,
                package_zip=False,
                path="build",
                name="/",
            ),
            build_spec=codebuild.BuildSpec.from_object({
                "version": "0.2",
                "phases": {
                    "install": {
                        "commands": [
                            "echo Installing dependencies...",
                            "npm install"
                        ]
                    },
                    "build": {
                        "commands": [
                            "echo Starting React build with env vars:",
                            "echo $REACT_APP_COGNITO_USER_POOL_ID",
                            "echo $REACT_APP_COGNITO_USER_POOL_CLIENT_ID",
                            "echo $REACT_APP_APIGATEWAY_BASE_URL_NOVA_SRV",
                            "echo $REACT_APP_APIGATEWAY_BASE_URL_EXTR_SRV",
                            "npm run build"
                        ]
                    }
                },
                "artifacts": {
                    "base-directory": "build",
                    "files": ["**/*"],
                    "discard-paths": "no"
                }
            }),
        )

        # Grant permissions
        source_asset.bucket.grant_read(project.role)
        staging_bucket.grant_write(project.role)

        # Invoke codebuild project using a custom resource
        build_trigger = cr.AwsCustomResource(
            self,
            "TriggerBuild",
            on_create=cr.AwsSdkCall(
                service="CodeBuild",
                action="startBuild",
                parameters={"projectName": project.project_name},
                physical_resource_id=cr.PhysicalResourceId.of("InitialBuild"),
                output_paths=[]   # limit response
            ),
            policy=cr.AwsCustomResourcePolicy.from_sdk_calls(
                resources=cr.AwsCustomResourcePolicy.ANY_RESOURCE
            ),
        )

        # Add 5-minute delay after CodeBuild deployment
        delay_provider = cr.Provider(
            self,
            "DelayProvider",
            on_event_handler=_lambda.Function(
                self,
                "DelayFunction",
                runtime=_lambda.Runtime.PYTHON_3_9,
                handler="index.on_event",
                code=_lambda.Code.from_inline("""
import time

def on_event(event, context):
    if event['RequestType'] == 'Create':
        time.sleep(300)  # 5 minutes delay
    return {'PhysicalResourceId': 'DelayResource'}
"""),
                timeout=Duration.minutes(10)
            )
        )
        
        delay_resource = _cfn.CfnCustomResource(
            self,
            "DelayAfterBuild",
            service_token=delay_provider.service_token
        )
        
        delay_resource.node.add_dependency(build_trigger)


    def deploy_cloudfront(self):
        # Create Origin Access Identity for web bucket
        cf_oai_web = _cloudfront.OriginAccessIdentity(self, 'CloudFrontOriginAccessIdentityWeb')

        # Create Origin Access Identity for data bucket (videos/images)
        cf_oai_data = _cloudfront.OriginAccessIdentity(self, 'CloudFrontOriginAccessIdentityData')

        # Grant OAI access to web bucket
        self.web_bucket.add_to_resource_policy(_iam.PolicyStatement(
            actions=["s3:GetObject"],
            resources=[self.web_bucket.arn_for_objects('*')],
            principals=[_iam.CanonicalUserPrincipal(
                cf_oai_web.cloud_front_origin_access_identity_s3_canonical_user_id
            )],
        ))

        # Grant OAI access to data bucket
        data_bucket = _s3.Bucket.from_bucket_name(self, "DataBucketForCloudFront", bucket_name=self.s3_bucket_name_data)
        data_bucket.add_to_resource_policy(_iam.PolicyStatement(
            actions=["s3:GetObject"],
            resources=[data_bucket.arn_for_objects('*')],
            principals=[_iam.CanonicalUserPrincipal(
                cf_oai_data.cloud_front_origin_access_identity_s3_canonical_user_id
            )],
        ))

        cf_dist = _cloudfront.CloudFrontWebDistribution(self, "nova-mme-web-cloudfront-dist",
            origin_configs=[
                # Web bucket origin (default)
                _cloudfront.SourceConfiguration(
                    s3_origin_source=_cloudfront.S3OriginConfig(
                        s3_bucket_source=self.web_bucket,
                        origin_access_identity=cf_oai_web
                    ),
                    behaviors=[_cloudfront.Behavior(
                        is_default_behavior=True,
                        viewer_protocol_policy=_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    )]
                ),
                # Data bucket origin (for videos, images, audio)
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
                    )]
                )
            ],
            default_root_object="index.html",
            logging_config = _cloudfront.LoggingConfiguration(
                bucket=self.web_log_bucket,
                include_cookies=False,
                prefix="access-log/"
            ),
            http_version=_cloudfront.HttpVersion.HTTP2_AND_3,
        )
        self.output_url = cf_dist.distribution_domain_name
        self.cloudfront_domain_name = cf_dist.distribution_domain_name

        # Store CloudFront domain in SSM Parameter for Lambda functions to use
        _ssm.StringParameter(
            self,
            "CloudFrontDomainParameter",
            parameter_name="/nova-mme/cloudfront-domain",
            string_value=cf_dist.distribution_domain_name,
            description="CloudFront domain name for video delivery"
        )

        # Output CloudFront domain
        CfnOutput(
            self,
            "CloudFrontDomainName",
            value=cf_dist.distribution_domain_name,
            description="CloudFront domain for video/media delivery"
        )
