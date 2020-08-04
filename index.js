require('dotenv').config()
const axios = require('axios')
const mysql = require('mysql')
const moment = require('moment')
const ms = require('ms')

const RefreshInterval = ms(process.env.REFRESH_INTERVAL)
const RPC_URL = `http://${process.env.RPC_HOSTNAME}:${process.env.RPC_PORT}`

const checkForRPC = () => {
  return new Promise((resolve, reject) => {
    var data = JSON.stringify({ method: 'getinfo' })

    var config = {
      method: 'post',
      url: RPC_URL,
      auth: {
        username: process.env.RPC_USERNAME,
        password: process.env.RPC_PASSWORD
      },
      headers: {
        'Content-Type': 'application/json'
      },
      data: data
    }

    axios(config)
      .then(resolve(true))
      .catch((error) => {
        error.message && console.error(error.message)
        reject(new Error('RPC Server is not reachable!'))
      })
  })
}

let db = null
const checkForDB = () => {
  return new Promise((resolve, reject) => {
    db = mysql.createConnection({
      host: process.env.MYSQL_HOSTNAME,
      port: process.env.MYSQL_PORT,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    })

    db.connect(function (err) {
      if (err) return reject(err)
      resolve()
    })
  })
}

const newLine = () => {
  console.log('')
}

const checkForTable = (TableName) => {
  return new Promise((resolve, reject) => {
    db.query(`SELECT id FROM ${TableName}`, err => {
      if (err === null) {
        console.log(`DB: ${TableName} already exists.`)
        return resolve(true)
      }
      reject(err)
    })
  })
}

const createTable = (TableName, Fields) => {
  return new Promise((resolve, reject) => {
    const CreateTableQuery = `
    CREATE TABLE \`${TableName}\` (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ${Fields.join(',')},
      \`created\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP(),
      PRIMARY KEY (\`id\`)
    )
    COLLATE='utf8mb4_general_ci';`

    db.query(CreateTableQuery, (err, result) => {
      if (err === null) return resolve(true)
      reject(err)
    })
  })
}

const createTableIfNeeded = (TableName, Config) => {
  console.log(`DB: Checking for ${TableName} ...`)
  return new Promise((resolve, reject) => {
    checkForTable(TableName).then(resolve).catch(() => {
      console.log(`DB: Creating ${TableName} ...`)
      createTable(TableName, Config).then(resolve).catch(reject)
    })
  })
}

const logWT = (...args) => {
  console.log(`[${moment().toLocaleString()}]:`, ...args)
}

const getFromRPC = (command) => {
  return new Promise((resolve, reject) => {
    var data = JSON.stringify({ method: command })

    var config = {
      method: 'post',
      url: RPC_URL,
      auth: {
        username: process.env.RPC_USERNAME,
        password: process.env.RPC_PASSWORD
      },
      headers: {
        'Content-Type': 'application/json'
      },
      data: data
    }

    axios(config)
      .then(response => {
        resolve(response.data.result)
      })
      .catch((error) => {
        error.message && console.error(error.message)
        reject(new Error('RPC Error!'))
      })
  })
}

const writeToDb = (TableName, Data) => {
  return new Promise((resolve, reject) => {
    var SqlQuery = `INSERT INTO ${TableName} (${Object.keys(Data).join(',')}) VALUES (?)`

    const Values = Object.keys(Data).map(Key => {
      if (Data[Key] === true) return 1
      if (Data[Key] === false) return 0
      return Data[Key]
    })

    db.query(SqlQuery, [Values], (err, result) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

const doLogger = () => {
  logWT('# Start Logging ...')

  Promise.all([
    getFromRPC('getblockchaininfo'),
    getFromRPC('getwalletinfo'),
    getFromRPC('getstakinginfo')
  ]).then(([getblockchaininfo, getwalletinfo, getstakinginfo]) => {
    delete getstakinginfo['search-interval']

    logWT('Load from RPC Server successful.')
    Promise.all([
      writeToDb('getblockchaininfo', getblockchaininfo),
      writeToDb('getwalletinfo', getwalletinfo),
      writeToDb('getstakinginfo', getstakinginfo)
    ]).then(() => {
      logWT('Write to DB successful.')
      logWT('# Done Logging.')
      newLine()
    }).catch(console.error)
  })
}

const startLogger = () => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Executing every ${RefreshInterval}ms ...`)
      return setInterval(doLogger, RefreshInterval) && resolve()
    } catch (err) {
      reject(err)
    }
  })
}

Promise.all([
  checkForRPC(),
  checkForDB()
]).then(() => {
  newLine()
  console.log('### REQUIREMENTS CHECK DONE ###')
  console.log('RPC Server Check', ['[', process.env.RPC_HOSTNAME, ':', process.env.RPC_PORT, ']'].join(''), '... OK')
  console.log('DB Server Check', ['[', process.env.MYSQL_HOSTNAME, ':', process.env.MYSQL_PORT, ']'].join(''), '... OK')

  newLine()
  console.log('### SETUP DATABASE')
  new Promise((resolve, reject) => {
    Promise.all([
      createTableIfNeeded('getblockchaininfo', [
        'chain VARCHAR(255) NULL DEFAULT NULL',
        'blocks INT NULL DEFAULT NULL',
        'bestblockhash VARCHAR(64) NULL DEFAULT NULL',
        'difficulty FLOAT NULL DEFAULT NULL',
        'verificationprogress FLOAT NULL DEFAULT NULL',
        'chainwork VARCHAR(64) NULL DEFAULT NULL'
      ]),
      createTableIfNeeded('getwalletinfo', [
        'walletversion INT NULL DEFAULT NULL',
        'balance FLOAT NULL DEFAULT NULL',
        'txcount INT NULL DEFAULT NULL',
        'keypoololdest BIGINT NULL DEFAULT NULL',
        'keypoolsize INT NULL DEFAULT NULL',
        'unlocked_until INT NULL DEFAULT NULL'
      ]),
      createTableIfNeeded('getstakinginfo', [
        'enabled BOOL NOT NULL DEFAULT 0',
        'staking BOOL NOT NULL DEFAULT 0',
        'currentblocksize INT NULL DEFAULT NULL',
        'currentblocktx INT NULL DEFAULT NULL',
        'pooledtx INT NULL DEFAULT NULL',
        'difficulty FLOAT NULL DEFAULT NULL',
        'averageweight BIGINT NULL DEFAULT NULL',
        'totalweight BIGINT NULL DEFAULT NULL',
        'netstakeweight BIGINT NULL DEFAULT NULL',
        'expectedtime BIGINT NULL DEFAULT NULL'
      ])
    ]).then(InitResults => {
      if (!InitResults.includes(false)) {
        resolve(true)
      }
    })
  }).then(dbInitResult => {
    console.log('DB Setup', '...', dbInitResult === true ? 'DONE' : 'ERROR')

    newLine()
    console.log('### STARTING REDDCOIN-LOGGER ###')

    startLogger().then(() => {
      console.log('Logger has been started ...')
      newLine()
      doLogger()
    })
  }).catch(error => {
    error.message && console.error(error.message)
    throw new Error('Error while initializing database.')
  })
}).catch(error => {
  console.error('REDDCOIN-LOGGER LAUNCH', error)
})
