#!/bin/sh

set -ex

/backend &

nginx -g "daemon off;"
