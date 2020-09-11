const puppeteer = require('puppeteer');
const { antiCaptchaKey } = require('./config');
const { URL } = require('url');
const ora = require('ora');
const spinner = ora({ spinner: 'dots12' });
const anticaptcha = require('./anticaptcha')(antiCaptchaKey);
const fs = require('fs');
anticaptcha.setMinLength(5);
anticaptcha.setMaxLength(5);
anticaptcha.setNumeric(2); // only letters

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

(async () => {

  let CITY = 'Istanbul'
  let eDevletURL = LINKS[CITY];
  // let eDevletURL = LINKS['Istanbul'];
  console.log('Launching Browser');
  // const browser = await puppeteer.launch({ headless: false });
  const browser = await puppeteer.launch({ headless: true });

  // Load page
  console.log('Opened new page');
  const page = await browser.newPage();

  // Extract the CAPTCHA image.
  let captchaBase64 = '';
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
  await page.goto(eDevletURL);
  console.log('Loaded page');

  let dateStr = '02/09/2018';
  await enterDate(page, dateStr);
  let id = await solveCaptchaAndSubmit(page, captchaSolver, captchaBase64);

  // Until captcha is solved correctly, complain and submit again.
  let trials = 1;
  while (await isCaptchaError(page)) {
    console.log('❌ Incorrect Captcha');
    await anticaptcha.reportIncorrectImageCaptcha(id, (response) => {
      console.log(response)
      if (response.status === 'success')
        console.log('Successfully sent complatint for task ' + id);
      else
        console.error(response);
    }); // Send complaint.
    trials++;
    await enterDate(page, dateStr);
    id = await solveCaptchaAndSubmit(page, captchaSolver, captchaBase64);
  }
  console.log('Solved in ', trials, ' trials');

  let count = await extractDeathCount(page);
  console.log('Total ', count, ' deaths found');

  await savePagePDF(page, 'test', CITY);
  // await browser.close();
})();





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
 * @param {String} captchaBase64
 * @returns {Promise<String>} that resolves to the captcha solution text.
 */
function solveAntiCaptcha(captchaBase64) {
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
              if (err)
                reject(err);
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
 * @param {String} captchaBase64 - Captcha as base64 String
 * @returns {Promise} that resolves to the ID of the 2Captcha work. Used for wrong captcha complaints.
 */
async function solveCaptchaAndSubmit(page, client, captchaBase64) {
  try {
    let { text, id } = await solveAntiCaptcha(captchaBase64);
    spinner.succeed('Solved captcha: ' + text + ' with id: ' + id);
    await page.focus('#captcha_name');
    await page.keyboard.type(text);
    await page.focus('#mainForm > div > input.submitButton');
    await page.keyboard.press('Space');
    await page.waitForNavigation();
    return id;
  } catch (err) {
    spinner.stopAndPersist({ symbol: '⚠️', text: 'Error solving captcha' });
    console.log(err);
  }
}

function sleep(sec) {
  return new Promise(resolve => setTimeout(resolve, sec * 1000));
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
    .catch(console.err);
}

async function savePagePDF(page, dateStr, cityName) {
  let dir = `./pdfs/${cityName}/`;
  console.log('Saving PDF');
  if (!fs.existsSync(dir)) // mkdir if missing
    fs.mkdirSync(dir, { recursive: true });
  return page.pdf({ path: `${dir}/${dateStr}.pdf` });
}