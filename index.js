require('dotenv').config()
const axios = require('axios')
const mysql = require('mysql')
const moment = require('moment')
const cron = require('node-cron')
const os = require('os')

const RPC_URL = `http://${process.env.RPC_HOSTNAME}:${process.env.RPC_PORT}`

const LogCurrencies = String(process.env.CC_PRICES).split(',')

const checkForRPC = () => {
  return new Promise((resolve, reject) => {
    var data = JSON.stringify({ method: 'getinfo' })

    axios({
      method: 'post',
      url: RPC_URL,
      auth: {
        username: process.env.RPC_USERNAME,
        password: process.env.RPC_PASSWORD
      },
      headers: {
        'Content-Type': 'application/json'
      },
      data: data,
      timeout: 3000
    })
      .then(() => {
        resolve(true)
      })
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
      ${Fields.map(Field => {
        return getCreateTableColumn(...Field)
      }).join(',' + os.EOL)},
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

const writeToDb = (TableName, Data, Fields = '*') => {
  return new Promise((resolve, reject) => {
    const AllowedKeys = Object.keys(Data).filter(Key => {
      return Fields === '*' || Fields.includes(Key)
    })

    var SqlQuery = `INSERT INTO ${TableName} (${AllowedKeys.join(',')}) VALUES (?)`

    const Values = AllowedKeys.map(Key => {
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
    getFromRPC('getstakinginfo'),
    getFromRPC('getinfo'),
    getFromRPC('getwalletinfo')
  ]).then(([getstakinginfo, getinfo, getwalletinfo]) => {
    logWT('Load from RPC Server successful.')
    getinfo.txcount = getwalletinfo.txcount
    Promise.all([
      writeToDb('getstakinginfo', getstakinginfo, ['staking', 'averageweight', 'totalweight', 'netstakeweight', 'expectedtime']),
      writeToDb('getinfo', getinfo, ['balance', 'txcount', 'blocks', 'moneysupply'])
    ]).then(() => {
      logWT('Write to DB successful.')
      logWT('# Done Logging.')
      newLine()
    }).catch(console.error)
  })
}

const doPriceLogger = () => {
  axios({
    url: `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=RDD&tsyms=${LogCurrencies.join(',')}`,
    headers: {
      Authorization: `Apikey ${process.env.CC_API_KEY}`
    }
  }).then(response => {
    LogCurrencies.map(currency => {
      writeToDb('prices', {
        currency: currency,
        price: response.data.RAW.RDD[currency].PRICE,
        priceView: response.data.DISPLAY.RDD[currency].PRICE
      })
    })
  })
}

const startLogger = () => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Executing Cron: ${process.env.REFRESH_INTERVAL}`)
      cron.schedule(process.env.REFRESH_INTERVAL, () => {
        doLogger()
        doPriceLogger()
      })

      resolve()
    } catch (err) {
      reject(err)
    }
  })
}

const getCreateTableColumn = (Name, Type, Null = true, Default = 'DEFAULT NULL') => {
  const FinalNull = Null === true ? 'NULL' : 'NOT NULL'
  const FinalDefault = Default === 'DEFAULT NULL' ? 'DEFAULT NULL' : `DEFAULT ${Default}`
  return `\`${Name}\` ${Type} ${FinalNull} ${FinalDefault}`
}

const startProcess = () => {
  return new Promise((resolve, reject) => {
    Promise.all([
      checkForRPC(),
      checkForDB()
    ]).then(() => {
      newLine()
      console.log('### REQUIREMENTS CHECK DONE ###')
      console.log('RPC Server Check', ['[', process.env.RPC_HOSTNAME, ':', process.env.RPC_PORT, ']'].join(''), '... OK')
      console.log('DB Server Check', ['[', process.env.MYSQL_HOSTNAME, ':', process.env.MYSQL_PORT, ']'].join(''), '... OK')

      clearInterval(LaunchIntervalID)

      newLine()
      console.log('### SETUP DATABASE')

      new Promise(resolve => {
        Promise.all([
          createTableIfNeeded('getinfo', [
            ['balance', 'DOUBLE'],
            ['txcount', 'INT'],
            ['blocks', 'INT'],
            ['moneysupply', 'DOUBLE']
          ]),
          createTableIfNeeded('getstakinginfo', [
            ['staking', 'BOOL', false, 0],
            ['averageweight', 'BIGINT'],
            ['totalweight', 'BIGINT'],
            ['netstakeweight', 'BIGINT'],
            ['expectedtime', 'BIGINT']
          ]),
          createTableIfNeeded('prices', [
            ['currency', 'VARCHAR(32)'],
            ['price', 'DOUBLE'],
            ['priceView', 'VARCHAR(64)']
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
        startLogger().then(resolve).catch(reject)
      }).catch(error => {
        error.message && console.error(error.message)
        throw new Error('Error while initializing database.')
      })
    }).catch(error => {
      console.error('REDDCOIN-LOGGER LAUNCH', error)
      console.log(`Retrying in ${ProcessRetryInterval / 1000} seconds ...`)
      newLine()
      reject(new Error())
    })
  })
}

const showProcessStartMessage = () => {
  console.log('Logger has been started ...')
  newLine()
}

let LaunchIntervalID = false
const ProcessRetryInterval = 5000
startProcess().then(showProcessStartMessage).catch(() => {
  LaunchIntervalID = setInterval(() => {
    startProcess().then(() => {
      showProcessStartMessage()
      clearInterval(LaunchIntervalID)
    }).catch(() => {})
  }, ProcessRetryInterval)
})
