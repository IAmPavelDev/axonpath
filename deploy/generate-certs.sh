#!/usr/bin/env bash
# Generate a private CA + server certificate for the Axon AWS beta endpoint
# (HTTPS on the static Elastic IP, no domain).
#
#   ./deploy/generate-certs.sh <STATIC_IP> [--force]
#
# Outputs:
#   deploy/certs/ca.key          CA private key — KEEP OFF THE SERVER, never commit,
#                                never lose it (it signs any future/rotated certs)
#   deploy/certs/axon-ca.crt     CA certificate — copied to apps/mobile/ca/axon-ca.crt
#                                (bundled into the APK) and used for curl --cacert
#   deploy/certs/server.crt|.key TLS cert (SAN = <STATIC_IP>) + key — mounted by Caddy
set -euo pipefail

IP="${1:?usage: $0 <STATIC_IP> [--force]}"
FORCE="${2:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/deploy/certs"
APP_CA="$ROOT/apps/mobile/ca/axon-ca.crt"

if [[ -f "$DIR/server.crt" && "$FORCE" != "--force" ]]; then
  echo "deploy/certs/server.crt already exists — rerun with --force to regenerate" >&2
  exit 1
fi
if [[ ! "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "not an IPv4 address: $IP" >&2
  exit 1
fi

mkdir -p "$DIR"

# 1. Private CA (10 years).
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$DIR/ca.key" -out "$DIR/axon-ca.crt" -days 3650 -sha256 \
  -subj "/CN=axon-beta-ca" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2. Server key + cert signed by the CA. The IP goes into SAN — modern TLS
#    clients ignore CN alone.
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$DIR/server.key" -out "$DIR/server.csr" \
  -subj "/CN=axon-beta-server"

EXT="$(mktemp)"
trap 'rm -f "$EXT"' EXIT
cat > "$EXT" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=IP:$IP
EOF
openssl x509 -req -in "$DIR/server.csr" -sha256 -days 3650 \
  -CA "$DIR/axon-ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -extfile "$EXT" -out "$DIR/server.crt"
rm -f "$DIR/server.csr"

# 3. CA copy for the Android config plugin (committed: it is a public cert;
#    only ca.key is secret).
mkdir -p "$(dirname "$APP_CA")"
cp "$DIR/axon-ca.crt" "$APP_CA"

chmod 600 "$DIR/ca.key" "$DIR/server.key"

echo "OK. Verify:"
echo "  openssl x509 -in $DIR/server.crt -noout -text | grep -A1 'Subject Alternative Name'   # expect IP:$IP"
echo "  openssl verify -CAfile $DIR/axon-ca.crt $DIR/server.crt                               # expect OK"
echo "Next:"
echo "  1. scp \$DIR/server.crt \$DIR/server.key \$DIR/axon-ca.crt to the server's ~/axon/deploy/certs/"
echo "  2. commit apps/mobile/ca/axon-ca.crt (public material) so EAS builds bundle it"
echo "  3. keep deploy/certs/ca.key private on this machine"
