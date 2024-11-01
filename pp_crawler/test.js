const fetch = require('node-fetch');  // For Node.js environment
const FormData = require('form-data');  // For handling form data in Node.js
const puppeteer = require('puppeteer');

// Function to send inference request
async function sendInferenceRequest(screenshotBuffer, url) {
    const formData = new FormData();
    
    // Append the Puppeteer screenshot buffer and domain name to the form data
    formData.append('image', screenshotBuffer, 'screenshot.png');  // Pass the screenshot buffer directly
    formData.append('url', url);

    try {
        const response = await fetch('http://localhost:65000/infer', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const result = await response.json();

        // Return the result from the inference service
        return result;
    } catch (error) {
        console.error('Error occurred while sending request:', error);
        return null;
    }
}

// Function to capture screenshot and send inference request
async function processDomain(url) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Set the viewport to 1920x1080
    await page.setViewport({
        width: 1920,
        height: 1080
    });

    // Go to the page and wait for it to be fully loaded
    await page.goto(url, {
        waitUntil: 'networkidle0'  // Ensures the page is fully loaded
    });

    // Take a screenshot
    const screenshotBuffer = await page.screenshot();

    // Send the screenshot buffer and domain name to the inference service
    const inf_resp = await sendInferenceRequest(screenshotBuffer, url);
    
    console.log(JSON.stringify(inf_resp, null, 2));

    await browser.close();
}

// Example usage: Call the function with the domain name
processDomain('https://google.com');
