const puppeteer = require('puppeteer');

async function highlightElementCenter(page, element) {
    // Highlight the center of the element by adding a red dot at the center
    await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const marker = document.createElement('div');
        marker.style.position = 'absolute';
        marker.style.width = '10px';
        marker.style.height = '10px';
        marker.style.backgroundColor = 'red';
        marker.style.borderRadius = '50%';
        marker.style.zIndex = '10000';
        marker.style.top = `${rect.top + window.scrollY + rect.height / 2 - 5}px`; // Center vertically
        marker.style.left = `${rect.left + window.scrollX + rect.width / 2 - 5}px`; // Center horizontally
        document.body.appendChild(marker);
    }, element);
}

async function exploreClickableElements(page, startUrl, depth, maxDepth) {
    if (depth > maxDepth) {
        return;
    }

    // Find all clickable elements (links, buttons, and input[type=button/submit])
    const clickableElements = await page.$$(
        'a, button, input[type=button], input[type=submit]'
    );

    console.log(`Depth: ${depth}, Found ${clickableElements.length} clickable elements`);

    for (let i = 0; i < clickableElements.length; i++) {
        const element = clickableElements[i];

        try {
            // Get the text and tag name for tracking
            const tagName = await page.evaluate(el => el.tagName, element);
            const elementText = await page.evaluate(el => el.innerText, element);

            console.log(`Clicking on ${tagName} with text: "${elementText}" at depth ${depth}`);

            // Highlight the center of the element with a red dot
            await highlightElementCenter(page, element);

            // Wait for 3 seconds to make the marker visible
            await page.waitForTimeout(3000);

            // Check if the element is interactable (visible and clickable)
            const isVisible = await page.evaluate(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }, element);

            if (!isVisible) {
                console.log(`Skipping ${tagName} because it is not visible or interactable.`);
                continue;
            }

            // Save the current page state to come back to it after clicking
            const currentUrl = page.url();

            // Use try-catch around navigation to ensure we handle errors
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(err => console.log('Navigation error:', err)), // Wait for navigation to complete
                element.click().catch(err => console.log(`Error clicking ${tagName}: ${err}`)) // Click the element
            ]);

            // Explore further on the new page state
            await exploreClickableElements(page, startUrl, depth + 1, maxDepth);

            // Navigate back to the previous page
            await page.goto(currentUrl, { waitUntil: 'networkidle0' });

        } catch (error) {
            console.log(`Error clicking element: ${error}`);
            console.log(`Navigating back to the initial URL and moving to the next element.`);

            // On any error, navigate back to the initial URL
            await page.goto(startUrl, { waitUntil: 'networkidle0' });
        }
    }
}

(async () => {
    // Launch the Puppeteer browser
    const browser = await puppeteer.launch({ headless: false }); // Set headless to true if you don't need a browser window
    const page = await browser.newPage();

    // Start from the main URL
    const startUrl = 'https://facebook.com'; // Replace with your target URL
    await page.goto(startUrl);

    // Explore clickable elements up to depth 3
    const maxDepth = 3;
    await exploreClickableElements(page, startUrl, 0, maxDepth);

    // Close the browser when done
    await browser.close();
})();
