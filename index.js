const puppeteer = require('puppeteer');
const { antiCaptchaKey } = require('./config');
const { URL } = require('url');
const ora = require('ora');
const spinner = ora({ spinner: 'dots12' });
const anticaptcha = require('./anticaptcha')(antiCaptchaKey);
const fs = require('fs');
const csv = require('fast-csv');
const moment = require('moment');
const { resolve } = require('path');
anticaptcha.setMinLength(5);
anticaptcha.setMaxLength(5);
anticaptcha.setNumeric(2); // only letters
anticaptcha.setPhrase(false);
anticaptcha.setCase(false);
anticaptcha.setMath(false);

const CITIES = ['Istanbul', 'Konya', 'Bursa', 'Antalya', 'Erzurum', 'Diyarbakir', 'Kocaeli', 'Kahramanmaras', 'Malatya', 'Sakarya', 'Tekirdag'];
const LINKS = {
  'Istanbul': 'https://www.turkiye.gov.tr/istanbul-buyuksehir-belediyesi-vefat-sorgulama',
  'Konya': 'https://www.turkiye.gov.tr/konya-buyuksehir-belediyesi-vefat-sorgulama',
  'Bursa': 'https://www.turkiye.gov.tr/bursa-buyuksehir-belediyesi-vefat-sorgulama',
  'Antalya': 'https://www.turkiye.gov.tr/antalya-buyuksehir-belediyesi-vefat-sorgulama',
  'Erzurum': 'https://www.turkiye.gov.tr/erzurum-buyuksehir-belediyesi-vefat-sorgulama',
  'Diyarbakir': 'https://www.turkiye.gov.tr/diyarbakir-buyuksehir-belediyesi-vefat-sorgulama',
  'Kocaeli': 'https://www.turkiye.gov.tr/kocaeli-buyuksehir-belediyesi-vefat-sorgulama',
  'Kahramanmaras': 'https://www.turkiye.gov.tr/kahramanmaras-buyuksehir-belediyesi-vefat-sorgulama',
  'Malatya': 'https://www.turkiye.gov.tr/malatya-buyuksehir-belediyesi-vefat-sorgulama',
  'Sakarya': 'https://www.turkiye.gov.tr/sakarya-buyuksehir-belediyesi-vefat-sorgulama',
  'Tekirdag': 'https://www.turkiye.gov.tr/tekirdag-buyuksehir-belediyesi-vefat-sorgulama'
};
const city = process.argv[2]; // Get city name as first arg.
const CSV_PATH = `./csv/${city.toLowerCase()}.csv`;
let captchaBase64 = '';

init()
  .then(main);

async function init() {
  if (!CITIES.includes(city)) {
    console.error('Wrong city name. Either city is not included or misspelled.');
    process.exit(-1);
  }

  if (!fs.existsSync('./csv/')) { // Create .csv dir
    fs.mkdirSync('./csv/');
  }

  if (!fs.existsSync(CSV_PATH)) { // 01 Jan if not processed before.
    firstDay = moment('2020-01-01');
  } else { // Lookup the last day. Assign the next day as first day.
    let lastRow = await getLastRow(CSV_PATH);
    let date = lastRow[0] + '.2020';
    firstDay = moment(date, 'DD.MM.YYYY').add(1, 'day');
  }
  lastDay = moment(); // Today
  // let lastDay = moment('2020-02-01'); // Excluding
  let numberOfDays = lastDay.diff(firstDay, 'days');

  console.log('First Day: ' + firstDay.format('DD MMM') + '\t Last Day: ' + lastDay.format('DD MMM'));
  if (numberOfDays === 0) {
    console.log('Number of days ', numberOfDays);
    process.exit(0);
  }
  console.log('Number of days ', numberOfDays);
  return { firstDay, numberOfDays }
}

// Main func with async/await
async function main({ firstDay, numberOfDays }) {
  console.log('Launching Browser');
  // const browser = await puppeteer.launch({ headless: false });
  const browser = await puppeteer.launch({ headless: true });

  // Load page
  console.log('Opened new page');
  const page = await browser.newPage();

  // Extract the CAPTCHA image.
  page.on('response', async response => {
    let url = new URL(response.url()); //WHATWH URL API
    if (url.pathname === '/captcha') {
      console.log('Received new Captcha');
      const buffer = await response.buffer();
      captchaBase64 = buffer.toString('base64');
      // page.removeListener('response');
    }
  });
  console.log('Going to the URL');
  await page.goto(LINKS[city]);
  console.log('Loaded page');

  // CSV write settings.
  const csvStream = csv.format({
    headers: fs.existsSync(CSV_PATH) ? false : true, // Append if file exists.
    includeEndRowDelimiter: true
  });
  const fsWriteStream = fs.createWriteStream(CSV_PATH, { flags: 'a' }); // append flag.
  fsWriteStream.on('error', function (err) {
    console.error(err);
  });
  csvStream.pipe(fsWriteStream).on('end', () => process.exit());

  // Each day.
  for (let j = 0; j < numberOfDays; j++) {
    // 2020
    let date2020 = firstDay.clone().add(j, 'days');
    if (date2020.isSame('2020-02-29')) { // Skip 29th Feb
      date2020 = date2020.clone().add(1, 'days');
    }
    let count2020 = await getDeathsOnDate(page, date2020);
    let fileDate2020 = date2020.format('YYYY-MM-DD');
    await savePagePDF(page, fileDate2020, city);
    await page.goto(LINKS[city]); // Reload

    // 2019
    let date2019 = date2020.clone().subtract(1, 'year');
    let count2019 = await getDeathsOnDate(page, date2019);
    let fileDate2019 = date2019.format('YYYY-MM-DD');
    await savePagePDF(page, fileDate2019, city);
    await page.goto(LINKS[city]); // Reload

    // 2018
    let date2018 = date2019.clone().subtract(1, 'year');
    let count2018 = await getDeathsOnDate(page, date2018);
    let fileDate2018 = date2018.format('YYYY-MM-DD');
    await savePagePDF(page, fileDate2018, city);
    await page.goto(LINKS[city]); // Reload

    // 2017
    let date2017 = date2018.clone().subtract(1, 'year');
    let count2017 = await getDeathsOnDate(page, date2017);
    let fileDate2017 = date2017.format('YYYY-MM-DD');
    await savePagePDF(page, fileDate2017, city);
    await page.goto(LINKS[city]); // Reload

    console.log('==========================');
    console.log('\tTarih: ', date2020.format('DD.MM.YYYY'));
    console.log('\tVefat sayisi: ', count2020);
    console.log('\tTarih: ', date2019.format('DD.MM.YYYY'));
    console.log('\tVefat sayisi: ', count2019);
    console.log('\tTarih: ', date2018.format('DD.MM.YYYY'));
    console.log('\tVefat sayisi: ', count2018);
    console.log('\tTarih: ', date2017.format('DD.MM.YYYY'));
    console.log('\tVefat sayisi: ', count2017);
    csvStream.write({ Tarih: date2020.format('DD.MM'), VefatSayisi2020: count2020, VefatSayisi2019: count2019, VefatSayisi2018: count2018, VefatSayisi2017: count2017 });
  }
  csvStream.end();
  await browser.close();
}





async function getDeathsOnDate(page, date) {

  try {
    let dateStr = date.format('DD/MM/YYYY');
    let id = await submitCaptcha(page, dateStr);

    // Until captcha is solved correctly, complain and submit again.
    let trials = 1;
    while (await isCaptchaError(page)) {
      console.log('❌ Incorrect Captcha');
      anticaptcha.reportIncorrectImageCaptcha(id, function (error, response) { // Don't await.
        if (response.status === 'success')
          console.log('Successfully sent complatint for task ' + id);
      });
      trials++;
      id = await submitCaptcha(page, dateStr);
    }
    console.log('Solved in ', trials, ' trials');

    let count = await extractDeathCount(page);
    console.log('Total ', count, ' deaths found');
    return count;
  } catch (err) {
    console.error(err);
    return getDeathsOnDate(page, date); // Start over if error.
  }
}

/**
 * Function to extract count. Check "Toplam X " element at the bottom of table. Or count rows.
 * 
 * @param {Object} page - Puppeteer page object.
 * @returns {Promise<Number>} that resolves to number of deaths.
 */
function extractDeathCount(page) {
  return page.$eval('#contentStart > div > div > div > span')
    .then(elem => { // Found Toplam X element.
      let countStr = elem.innerHTML.match(/(Toplam )(\d+)/)[2];
      return parseInt(countStr);
    })
    .catch(() => {
      // count table rows.
      return page.$eval('#table > tbody', elem => {
        return elem.children.length;
      })
    });
}

async function enterDateAndSolve(page, dateStr) {
  await enterDate(page, dateStr);
  return solveAntiCaptcha().catch(err => { // If captcha solving fails getNewCaptcha and retry
    console.log('Caught the error');
    console.log(err.message);
    console.log('Getting new captcha.');
    return getNewCaptcha(page).then(() => {
      console.log('Trying to solve the new captcha.')
      return enterDateAndSolve(page, dateStr)
    });
  });
}

async function getNewCaptcha(page) {
  await page.goto(LINKS[city]);
  await sleepSec(2);
}

async function enterDate(page, dateStr) {
  console.log('Changing date to ' + dateStr)
  await page.focus('#tarih');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(dateStr);
  console.log('Changed date to ' + dateStr);
}

/**
 * Funtion to solve captcha using AntiCaptcha.
 * 
 * @returns {Promise<Object>} that resolves to the captcha solution text and id {text: , id: }.
 */
function solveAntiCaptcha() {
  spinner.start('Solving captcha ');
  return new Promise((resolve, reject) => {
    // check balance first
    anticaptcha.getBalance(function (err, balance) {
      if (err)
        reject(err);
      if (balance > 0) {
        anticaptcha.createImageToTextTask({
          body: captchaBase64
        },
          function (err, taskId) {
            if (err)
              reject(err);
            spinner.text = 'Solving captcha with taskId: ' + taskId + ' ';
            anticaptcha.getTaskSolution(taskId, function (err, taskSolution) {
              if (err) {
                console.log('CUSTOM ERROR: Rejecting for reason below')
                reject(err);
              }
              resolve({ text: taskSolution, id: taskId });
            });
          }
        );
      } else {
        reject('Insufficient balance');
      }
    });
  })
}

/**
 * Function to have the captcha solved, submit the request, and have the page loaded.
 * 
 * @param {Object} page - Puppeteer page object
 * @param {Object} client - Captcha Solver Client
 * @returns {Promise} that resolves to the ID of the work. Used for wrong captcha complaints.
 */
async function submitCaptcha(page, dateStr) {
  // Sometimes captcha solvers just fail. Try at least three times if they fail.
  let { text, id } = await enterDateAndSolve(page, dateStr);
  spinner.succeed('Solved captcha: ' + text + ' with id: ' + id);
  await page.focus('#captcha_name');
  await page.keyboard.type(text);
  await page.focus('#mainForm > div > input.submitButton');
  await page.keyboard.press('Space');
  await page.waitForNavigation();
  return id;
}

function sleepSec(sec) {
  return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

async function retry(fn, n) {
  for (let i = 0; i < n; i++) {
    try {
      if (i > 0) {
        console.log('function ' + fn.name + ' failed. Trying ' + i + 1 + '. time');
      }
      return await fn();
    } catch (err) {
      console.error(err);
    }
  }

  throw new Error(`Failed retrying ${n} times`);
}
/**
 * Function to check if CAPTCHA error is currently shown on the page
 * 
 * @param {Object} - page, Puppeteer page obj 
 * @returns {Promise<Boolean>} that resolves to true if error is shown, false otherwise.
 */
function isCaptchaError(page) {
  return page.$('#mainForm > fieldset > div.formRow.required.errored > div.fieldError')
    .then(elem => elem !== null)
}

async function savePagePDF(page, dateStr, cityName) {
  let dir = `./pdfs/${cityName}/`;
  console.log('Saving PDF');
  if (!fs.existsSync(dir)) // mkdir if missing
    fs.mkdirSync(dir, { recursive: true });
  return page.pdf({ path: `${dir}/${dateStr}.pdf` });
}

function getLastRow(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let lastRow;
    csv.parseStream(stream)
      .on('error', error => reject(error))
      .on('data', row => lastRow = row)
      .on('end', () => {
        console.log('Last row is:', lastRow);
        resolve(lastRow);
      });
  })
}