const Xvfb = require('xvfb');
const puppeteer = require('puppeteer');

// Initialize XVFB
const xvfb = new Xvfb({
  displayNum: 99,
  timeout: 5000,
  silent: true,
  reuse: true
});

// Start XVFB synchronously
xvfb.startSync();

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--display=:99', '--no-sandbox']
  });
  const page = await browser.newPage();

  try {
    // Navigate to example.com
    await page.goto('https://example.com', { waitUntil: 'networkidle2' });

    // Scroll down the page
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    // Wait for a bit
    await page.waitForTimeout(1000);

    // Scroll back up
    await page.evaluate(() => {
      window.scrollBy(0, -window.innerHeight);
    });

    // Wait a bit to observe the scroll
    await page.waitForTimeout(1000);

    // Get all elements on the page
    const allElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements.map(el => el.outerHTML);
    });

    console.log('All elements on the page:', allElements);

    // Wait a bit to observe the interaction
    await page.waitForTimeout(2000);
  } catch (error) {
    console.error('Error during interaction:', error);
  } finally {
    // Close the browser and stop XVFB synchronously
    await browser.close();
    xvfb.stopSync();
  }
})();
