#!/bin/bash
# Incident diagnostic: API Gateway payload-format x request-style matrix.
API="https://t3afkc5pj2.execute-api.eu-central-1.amazonaws.com"
TOK=$(cat /tmp/fb-token)
PAYLOAD=$1
INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id t3afkc5pj2 --region eu-central-1 --query 'Items[0].IntegrationId' --output text)
aws apigatewayv2 update-integration --api-id t3afkc5pj2 --integration-id "$INTEGRATION_ID" --region eu-central-1 --payload-format-version "$PAYLOAD" >/dev/null
sleep 3
echo "== payload $PAYLOAD =="
echo -n "single-raw: "
curl -s --max-time 20 "$API/rpc/skill/create" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"topic":"Matrix test","mode":"MANUAL"}' | head -c 110; echo
echo -n "batch: "
curl -s --max-time 20 "$API/rpc" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -H 'x-orpc-batch: buffered' -d "[{\"url\":\"$API/rpc/skill/create\",\"method\":\"POST\",\"headers\":{\"content-type\":\"application/json\"},\"body\":{\"json\":{\"topic\":\"Matrix test\",\"mode\":\"MANUAL\"}}}]" | head -c 110; echo
echo -n "get: "
curl -s --max-time 20 "$API/rpc/skill/get?id=15" -H "authorization: Bearer $TOK" | head -c 110; echo
