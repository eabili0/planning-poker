#!/bin/sh

dir=/opt/sstls
mkdir -p $dir
sudo chmod 700 $dir

openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout $dir/server.key \
    -out $dir/server.crt \
    -subj "/C=US/ST=Denial/L=Springfield/O=Dis/CN=pp.example.com"
