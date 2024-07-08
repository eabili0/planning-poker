# planning-poker

Simple planning poker application. Golang backend on `be` folder and a React+Tailwind frontend on `fe`.

# build

Run `docker compose build` to build the `eabili0/planning-poker:alpine` Docker image. 

You can retag the image if you like with `docker tag eabili0/planning-poker:alpine <your tag>` or by changing the image name in the `compose.yaml` file.

For simplicity, we kept both the backend and frontend in the same container image. 

You can see how each one gets built by analyzing the `Dockerfile` in the root folder.

# run

Simply run `docker compose up -d`, this should launch the HTTP website behind port `80` by default.

HTTPS website will be available at port `443` with a self-signed certificate. 

If you wish to provide a Trusted SSL Certificate, simply map to your docker container the folder `/opt/tls` with the following contents:

- `/opt/tls/server.crt`: the trusted certificate;
- `/opt/tls/server.key`: the trusted certificate's key;

# how-to-contribute

Please don't. Fork it and have fun!