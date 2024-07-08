#!/bin/sh

set -ex

if [[ ! -d "/opt/tls" ]]; then
    mv /opt/sstls /opt/tls
fi

openssl dhparam -out /opt/tls/dhparam.pem 2048

/backend &

nginx -g "daemon off;"
