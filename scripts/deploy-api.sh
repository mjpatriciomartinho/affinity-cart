#!/bin/sh
# Deploys the Affinity Cart service to AWS Lambda (Function URL, no API Gateway).
# Idempotent: creates what's missing, updates code otherwise.
#   AWS_PROFILE=javi-admin scripts/deploy-api.sh
set -eu
cd "$(dirname "$0")/.."
REGION=eu-west-1
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
FN=affinity-cart-api
ROLE=affinity-cart-api-role
BUCKET=affinity-cart-state-$ACCOUNT

echo "Bundling…"
rm -rf dist/api && mkdir -p dist/api
npx esbuild apps/api/src/lambda.ts --bundle --platform=node --target=node22 --format=esm \
  --outfile=dist/api/index.mjs --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --log-level=warning
(cd dist/api && zip -q function.zip index.mjs)

echo "State bucket ${BUCKET}…"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || \
  aws s3api create-bucket --bucket "$BUCKET" --region $REGION --create-bucket-configuration LocationConstraint=$REGION >/dev/null
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "Role ${ROLE}…"
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10 # IAM propagation
fi
# Least privilege: its own bucket, invoking itself, and only the two secrets it needs.
aws iam put-role-policy --role-name $ROLE --policy-name affinity-cart-api --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\"},
    {\"Effect\": \"Allow\", \"Action\": \"s3:ListBucket\", \"Resource\": \"arn:aws:s3:::$BUCKET\"},
    {\"Effect\": \"Allow\", \"Action\": \"lambda:InvokeFunction\", \"Resource\": \"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN\"},
    {\"Effect\": \"Allow\", \"Action\": \"ssm:GetParameter\", \"Resource\": [
      \"arn:aws:ssm:$REGION:$ACCOUNT:parameter/servikaki/secrets/affinity-cart-qloo.env\",
      \"arn:aws:ssm:$REGION:$ACCOUNT:parameter/servikaki/secrets/claude-servikaki.env\"]},
    {\"Effect\": \"Allow\", \"Action\": \"kms:Decrypt\", \"Resource\": \"*\", \"Condition\": {\"StringEquals\": {\"kms:ViaService\": \"ssm.$REGION.amazonaws.com\"}}}
  ]}"

echo "Function ${FN}…"
ENV="Variables={STATE_BUCKET=$BUCKET,NODE_OPTIONS=--enable-source-maps}"
if aws lambda get-function --function-name $FN --region $REGION >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --region $REGION --zip-file fileb://dist/api/function.zip >/dev/null
  aws lambda wait function-updated --function-name $FN --region $REGION
  aws lambda update-function-configuration --function-name $FN --region $REGION --environment "$ENV" >/dev/null
else
  aws lambda create-function --function-name $FN --region $REGION --runtime nodejs22.x --architectures arm64 \
    --handler index.handler --memory-size 1024 --timeout 900 \
    --role arn:aws:iam::$ACCOUNT:role/$ROLE --zip-file fileb://dist/api/function.zip --environment "$ENV" >/dev/null
  aws lambda wait function-active --function-name $FN --region $REGION
fi

# Public HTTPS endpoint. Auth is the store key header; CORS is handled by the app.
if ! aws lambda get-function-url-config --function-name $FN --region $REGION >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name $FN --region $REGION --auth-type NONE >/dev/null
  aws lambda add-permission --function-name $FN --region $REGION --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  # Public URLs also need InvokeFunction, scoped to calls that come through the URL.
  aws lambda add-permission --function-name $FN --region $REGION --statement-id public-url-invoke \
    --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null
fi
URL=$(aws lambda get-function-url-config --function-name $FN --region $REGION --query FunctionUrl --output text)
echo "API: ${URL}v1"
