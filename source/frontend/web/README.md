# AWS GenAI media analysis and policy evaluation

The static website is built using [React](https://github.com/facebook/create-react-app). It needs to be deployed together with the rest of the CDK package for a fully functioning solution. 

## To run the REACT app on your local machine

You can connect this REACT app to the backend services deployed using the CDK Backend stack by configuring the appropriate parameters in the .env file.

Replace the variables in the `.env.template` file with the services deployed using the CDK package at the parent level of this folder. (You can find the variable values from the main CloudFormation stack output.) Rename the file to `.env`.

Run the `generate_env_from_cloudformation_output.sh` script to fetch output values from the CloudFormation RootStack and generate the .env file automatically. This saves you from manually copying the values.

**Note**: You must have access to the AWS account where the CloudFormation stack is deployed.

In the project directory `web`, you can run:
```bash
npm install
```

If error:
```bash
npm install --force
```

Run the instance on your local machine by connecting to the service endpoints on AWS.

```bash
npm start
```

## To prepare a build that can be deployed together with the other backend code

```bash
npm run build
```
This command will generate a new build under the `build` folder with placeholders for the backend service URLs.

Deploy the UI to the AWS account hosting the backend and frontend resources. You will need to copy the build to the web S3 bucket with a default name: nova-mme-web-{account_id}-{region}
Run the following AWS CLI to sync the frontend code:
```bash
aws s3 sync ./build s3://nova-mme-web-{account_id}-{region}
```