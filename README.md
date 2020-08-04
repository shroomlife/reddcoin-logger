# ReddCoin Logger

## Usage

The logger is a little NodeJS app that is logging the wallet to a defioned database instance. This data can be used for example to create statistics or calculate predictions, etc...

## Prerequisites

* A running ReddCoin Server with an active RPC Instance
* A running MySQL Database

## Getting Started

Example `docker-compose.yml` file with all needed services on one single machine:

```yaml
version: '3.6'
services: 

  reddcoin-server:
    container_name: reddcoin-server
    image: reddcoincore/server:latest
    volumes:
      - "/root/.reddcoin:/root/.reddcoin"
    environment:
      - RPC_SERVER=1
      - RPC_USERNAME=rpcusername
      - RPC_PASSWORD=rpcpassword
      - RPC_PORT=45443
      - RPC_ALLOW_IP=0.0.0.0/0

  reddcoin-logger:
    container_name: reddcoin-logger
    image: shroomlife/reddcoin-logger:latest
    env_file: .env

  reddcoin-db:
    container_name: reddcoin-db
    image: mariadb:latest
    env_file: .env
```

Example `.env` file:

```sh
## ReddCoin Logger Configuration
RPC_HOSTNAME=reddcoin-server
RPC_PORT=45443
RPC_USERNAME=rpcusername
RPC_PASSWORD=CHANGE_ME
REFRESH_INTERVAL=10s

## MySQL Docker Configuration
MYSQL_HOSTNAME=reddcoin-db
MYSQL_PORT=3306
MYSQL_DATABASE=reddcoin
MYSQL_USER=reddcoin
MYSQL_PASSWORD=CHANGE_ME
MYSQL_RANDOM_ROOT_PASSWORD=1
TZ=Europe/Berlin
```
