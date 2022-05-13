#!/bin/sh

dapr run --app-id compute --app-protocol http --app-port 3011 --dapr-http-port 3010 --dapr-http-max-request-size 1024 --config ../../config.yaml --components-path ../../components -- python3 app.py