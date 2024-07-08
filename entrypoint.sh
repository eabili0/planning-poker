#!/bin/sh

set -ex

if [[ ! -d "/opt/tls" ]]; then
    mv /opt/sstls /opt/tls
    openssl dhparam -out /opt/tls/dhparam.pem 2048
fi

/backend &

nginx -g "daemon off;"
