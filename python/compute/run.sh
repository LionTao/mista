#!/bin/sh

dapr run --app-id compute --app-protocol http --app-port 3011 --dapr-http-port 3010 --config ../../config.yaml --components-path ../../components -- python3 app.py