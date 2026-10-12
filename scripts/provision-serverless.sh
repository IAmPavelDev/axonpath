#!/usr/bin/env bash
# Axon — serverless (Lambda) infrastructure provisioning.
#
# Creates/updates, in order: ECR repo, Lambda execution role, API + worker
# functions (one image, LAMBDA_ROLE env dispatches), API Gateway HTTP API,
# EventBridge Scheduler minute tick, and a $1 billing alarm (always in
# us-east-1 — the AWS/Billing namespace only exists there).
#
# Prerequisites:
#   - aws CLI v2 configured (aws configure) — credentials need IAM, Lambda,
#     ECR, Apigateway, Scheduler, SNS and CloudWatch access.
#   - the image pushed to ECR (see DEPLOY_AWS_SERVERLESS.md §3).
#   - .env.aws.serverless filled (cp .env.aws.serverless.example).
#
# Usage:
#   AWS_REGION=eu-central-1 ALERT_EMAIL=you@example.com \
#     bash scripts/provision-serverless.sh
set -euo pipefail

AWS_REGION="${AWS_REGION:?AWS_REGION is required (e.g. eu-central-1)}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
ENV_FILE="${ENV_FILE:-.env.aws.serverless}"
IMAGE_TAG="${IMAGE_TAG:-lambda}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (cp .env.aws.serverless.example $ENV_FILE)"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${DATABASE_URL:?DATABASE_URL required in $ENV_FILE}"
: "${QDRANT_URL:?QDRANT_URL required in $ENV_FILE}"

R="--region $AWS_REGION"
ECR_REPO="axon-backend"
ACCOUNT_ID="$(aws $R sts get-caller-identity --query Account --output text)"
ECR_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO"

say() { printf '\n== %s ==\n' "$*"; }

# ---------------------------------------------------------------- ECR repo
say "ECR repository"
aws $R ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1 || {
  aws $R ecr create-repository --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true >/dev/null
  echo "created $ECR_URI"
}

# ------------------------------------------------------------ Lambda role
say "Lambda execution role"
aws $R iam get-role --role-name axon-lambda-role >/dev/null 2>&1 || {
  aws $R iam create-role --role-name axon-lambda-role --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
}
aws $R iam put-role-policy --role-name axon-lambda-role --policy-name logs \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "*" }]
  }' >/dev/null
ROLE_ARN="$(aws $R iam get-role --role-name axon-lambda-role --query Role.Arn --output text)"

# ------------------------------------------------------- function env JSON
env_json() {
  jq -n \
    --arg role "$1" \
    --arg db "$DATABASE_URL" \
    --arg qdrantUrl "$QDRANT_URL" \
    --arg qdrantKey "$QDRANT_API_KEY" \
    --arg firebase "$FIREBASE_PROJECT_ID" \
    --arg zai "$ZAI_API_KEY" \
    --arg gemini "$GEMINI_API_KEY" \
    --arg logLevel "${LOG_LEVEL:-info}" \
    '{ Variables: {
        LAMBDA_ROLE: $role, NODE_ENV: "production", APP_PORT: "3001",
        DATABASE_URL: $db, QDRANT_URL: $qdrantUrl, QDRANT_API_KEY: $qdrantKey,
        FIREBASE_PROJECT_ID: $firebase, ZAI_API_KEY: $zai, GEMINI_API_KEY: $gemini,
        LOG_LEVEL: $logLevel } }'
}

upsert_function() { # name role timeout-seconds
  local name="$1" fn_role="$2" timeout="$3"
  if aws $R lambda get-function --function-name "$name" >/dev/null 2>&1; then
    echo "updating $name"
    aws $R lambda update-function-configuration --function-name "$name" \
      --timeout "$timeout" --memory-size 1024 --environment "$(env_json "$fn_role")" >/dev/null
    # Config and code updates cannot overlap on one function — wait for the
    # configuration change to settle before pushing the new image.
    aws $R lambda wait function-updated-v2 --function-name "$name" >/dev/null
    aws $R lambda update-function-code --function-name "$name" \
      --image-uri "$ECR_URI:$IMAGE_TAG" >/dev/null
  else
    echo "creating $name"
    aws $R lambda create-function --function-name "$name" \
      --package-type Image --code "ImageUri=$ECR_URI:$IMAGE_TAG" \
      --role "$ROLE_ARN" --timeout "$timeout" --memory-size 1024 \
      --architectures x86_64 --environment "$(env_json "$fn_role")" \
      --description "Axon backend ($fn_role)" >/dev/null
  fi
  aws $R lambda wait function-active --function-name "$name" >/dev/null
}

say "Lambda functions (one image, LAMBDA_ROLE dispatch)"
upsert_function axon-api api 30         # API Gateway caps HTTP at 30s
upsert_function axon-worker worker 900  # 15 min = one generation lease window
API_ARN="$(aws $R lambda get-function --function-name axon-api --query Configuration.FunctionArn --output text)"
WORKER_ARN="$(aws $R lambda get-function --function-name axon-worker --query Configuration.FunctionArn --output text)"

# -------------------------------------------------- API Gateway HTTP API
say "API Gateway HTTP API"
# Do NOT use create-api's --target quick-create: it wires a payload-format-2.0
# integration, which serverless-http cannot parse. The integration is created
# explicitly with payload 1.0.
API_ID="$(aws $R apigatewayv2 get-apis --query "Items[?Name=='axon-http'].ApiId" --output text)"
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID="$(aws $R apigatewayv2 create-api --name axon-http \
    --protocol-type HTTP --query ApiId --output text)"
fi
INTEGRATION_ID="$(aws $R apigatewayv2 get-integrations --api-id "$API_ID" --query 'Items[0].IntegrationId' --output text)"
if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
  INTEGRATION_ID="$(aws $R apigatewayv2 create-integration --api-id "$API_ID" \
    --integration-type AWS_PROXY --integration-uri "$API_ARN" \
    --payload-format-version '1.0' --query IntegrationId --output text)"
fi
aws $R apigatewayv2 create-route --api-id "$API_ID" --route-key "ANY /" --target "integrations/$INTEGRATION_ID" >/dev/null 2>&1 || true
aws $R apigatewayv2 create-route --api-id "$API_ID" --route-key "ANY /{proxy+}" --target "integrations/$INTEGRATION_ID" >/dev/null 2>&1 || true
# The invoke URL only serves traffic through the auto-deploying $default stage;
# create-api without --target does not create one, and without it every request
# 404s at the gateway ("Not Found" never reaching Lambda).
aws $R apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null 2>&1 || \
  aws $R apigatewayv2 update-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null

aws $R lambda add-permission --function-name axon-api --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*/*" >/dev/null 2>&1 || true

# --------------------------------------------------- Observability (logging)
say "Observability: access logs, metric filters, alarms"
# API GW access logs — the request-level audit trail (status counts, 5xx).
ACCESS_LOG_GROUP="/axon/apigw/access"
ACCESS_LOG_ARN="arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$ACCESS_LOG_GROUP"
if [ "$(aws $R logs describe-log-groups --log-group-name-prefix "$ACCESS_LOG_GROUP" \
  --query 'logGroups[0].logGroupName' --output text)" = "None" ]; then
  aws $R logs create-log-group --log-group-name "$ACCESS_LOG_GROUP" >/dev/null
fi
aws $R logs put-retention-policy --log-group-name "$ACCESS_LOG_GROUP" \
  --retention-in-days 30 >/dev/null
# shellcheck disable=SC2016  # $context.* is API GW log-format syntax, not shell
ACCESS_FORMAT='{ "requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","routeKey":"$context.routeKey","status":"$context.status","responseLength":"$context.responseLength","integrationErr":"$context.integration.error","errorMsg":"$context.error.message" }'
# Shorthand "K=V,K=V" breaks on the commas inside the Format JSON — pass it
# as proper JSON built by jq instead.
ACCESS_SETTINGS="$(jq -n --arg arn "$ACCESS_LOG_ARN" --arg fmt "$ACCESS_FORMAT" \
  '{DestinationArn: $arn, Format: $fmt}')"
aws $R apigatewayv2 update-stage --api-id "$API_ID" --stage-name '$default' \
  --access-log-settings "$ACCESS_SETTINGS" >/dev/null
# Lambda logs: 30-day retention (groups exist only after the first invocation).
for FN in axon-api axon-worker; do
  aws $R logs put-retention-policy --log-group-name "/aws/lambda/$FN" \
    --retention-in-days 30 >/dev/null 2>&1 || true
done

# Metrics feed CloudWatch alarms/dashboards without log queries:
#   Axon/Api Requests     — every request (empty pattern matches all lines)
#   Axon/Api Server5xx    — 5xx responses
#   Axon/Backend Errors   — pino level >= 50 (error|fatal) from either function
put_metric_filter() { # name log-group pattern namespace metric-name
  aws $R logs put-metric-filter --log-group-name "$2" --filter-name "$1" \
    --filter-pattern "$3" --metric-transformations \
    "metricNamespace=$4,metricName=$5,metricValue=1,defaultValue=0" >/dev/null
}
put_metric_filter axon-apigw-requests "$ACCESS_LOG_GROUP" "" "Axon/Api" Requests
put_metric_filter axon-apigw-5xx "$ACCESS_LOG_GROUP" '{ $.status = 5* }' "Axon/Api" Server5xx

# App alarms share ALERT_EMAIL but get their own regional topic (the billing
# topic lives in us-east-1, the metrics in $AWS_REGION).
if [ -n "$ALERT_EMAIL" ]; then
  APP_TOPIC_ARN="$(aws $R sns create-topic --name axon-alerts --query TopicArn --output text)"
  aws $R sns subscribe --topic-arn "$APP_TOPIC_ARN" --protocol email \
    --notification-endpoint "$ALERT_EMAIL" >/dev/null
  aws $R cloudwatch put-metric-alarm --alarm-name axon-api-5xx \
    --metric-name Server5xx --namespace Axon/Api --statistic Sum \
    --period 300 --evaluation-periods 1 --threshold 5 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$APP_TOPIC_ARN" >/dev/null
  aws $R cloudwatch put-metric-alarm --alarm-name axon-backend-errors \
    --metric-name Errors --namespace Axon/Backend --statistic Sum \
    --period 900 --evaluation-periods 1 --threshold 50 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$APP_TOPIC_ARN" >/dev/null
  echo "confirm the SNS subscription email for $ALERT_EMAIL (axon-alerts)"
fi

# ------------------------------------------------ EventBridge Scheduler tick
say "EventBridge Scheduler (worker tick, every minute)"
aws $R iam get-role --role-name axon-scheduler-role >/dev/null 2>&1 || {
  aws $R iam create-role --role-name axon-scheduler-role --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "scheduler.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
}
aws $R iam put-role-policy --role-name axon-scheduler-role --policy-name invoke-worker \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": \"lambda:InvokeFunction\", \"Resource\": \"$WORKER_ARN\" }]
  }" >/dev/null
SCHEDULER_ROLE_ARN="$(aws $R iam get-role --role-name axon-scheduler-role --query Role.Arn --output text)"

SCHED_TARGET="{ \"Arn\": \"$WORKER_ARN\", \"RoleArn\": \"$SCHEDULER_ROLE_ARN\", \"RetryPolicy\": { \"MaximumRetryAttempts\": 2, \"MaximumEventAgeInSeconds\": 300 } }"
aws $R scheduler create-schedule --name axon-worker-tick \
  --schedule-expression "rate(1 minute)" \
  --flexible-time-window '{ "Mode": "OFF" }' \
  --target "$SCHED_TARGET" >/dev/null 2>&1 || \
aws $R scheduler update-schedule --name axon-worker-tick \
  --schedule-expression "rate(1 minute)" \
  --flexible-time-window '{ "Mode": "OFF" }' \
  --target "$SCHED_TARGET" >/dev/null
aws $R lambda add-permission --function-name axon-worker --statement-id scheduler-invoke \
  --action lambda:InvokeFunction --principal scheduler.amazonaws.com \
  --source-arn "arn:aws:scheduler:$AWS_REGION:$ACCOUNT_ID:schedule/default/axon-worker-tick" >/dev/null 2>&1 || true

# ----------------------------------------------------------- Billing alarm
say "Billing alarm (\$1) + SNS"
if [ -n "$ALERT_EMAIL" ]; then
  TOPIC_ARN="$(aws --region us-east-1 sns create-topic --name axon-billing --query TopicArn --output text)"
  aws --region us-east-1 sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
    --notification-endpoint "$ALERT_EMAIL" >/dev/null
  aws --region us-east-1 cloudwatch put-metric-alarm --alarm-name axon-spend-over-1usd \
    --metric-name EstimatedCharges --namespace AWS/Billing --statistic Maximum \
    --period 21600 --evaluation-periods 1 --threshold 1 \
    --comparison-operator GreaterThanThreshold --dimensions Name=Currency,Value=USD \
    --alarm-actions "$TOPIC_ARN" >/dev/null
  echo "confirm the SNS subscription email for $ALERT_EMAIL"
else
  echo "ALERT_EMAIL not set — billing alarm skipped"
fi

ENDPOINT="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com"
say "Done"
echo "API endpoint : $ENDPOINT  (health: $ENDPOINT/health)"
echo "Functions    : axon-api (30s), axon-worker (15min, rate(1 minute))"
echo "Logs/Metrics : /axon/apigw/access + /aws/lambda/axon-* | Axon/Api, Axon/Backend"
