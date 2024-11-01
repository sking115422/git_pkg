'use strict';
var startTime = new Date();
var utils = require('./utils');
var config = require('./config');
const fs = require('fs')
const path = require('path');
const fetch = require('node-fetch');  // For Node.js environment
const FormData = require('form-data');  // For handling form data in Node.js

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const ppUserPrefs = require('puppeteer-extra-plugin-user-preferences')
const stealth = StealthPlugin()
puppeteer.use(StealthPlugin())

puppeteer.use(
  ppUserPrefs({
    userPrefs: {
      devtools: {
        preferences: {
          'network_log.preserve-log': '"true"'
        }
      }
    }
  })
)

const downloadPath = path.resolve(config.DOWNLOADS_DIR);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sterilizeUrl(url) {
  // Replace invalid characters with an underscore
  const sanitized = url.replace(/[\/:*?"<>|]/g, '_');
  
  // Optionally, truncate if the file name is too long (255 character limit)
  return sanitized.substring(0, 255);
}

function getCurrentTimestamp() {
  // Get the current time
  const now = new Date();
  
  // Format the time as YYYYMMDD.HH.MM
  const formattedTimestamp = now.getFullYear().toString() + 
      ('0' + (now.getMonth() + 1)).slice(-2) + 
      ('0' + now.getDate()).slice(-2) + '.' + 
      ('0' + now.getHours()).slice(-2) + '.' + 
      ('0' + now.getMinutes()).slice(-2);
  
  return formattedTimestamp;
}


function parseJsonToTabs(jsonData) {
  const elem_ctr_points = [];
  const all_elems = [];

  jsonData.forEach((data) => {
    data.annotations.forEach((annotation) => {
      const [x, y, width, height] = annotation.bbox;
      const label = annotation.category_id;

      // Add center points to elem_ctr_points
      const center = calculateCenter(x, y, width, height);
      elem_ctr_points.push([center.centerX, center.centerY]);

      // Add bbox values to all_elems
      all_elems.push([x, y, width, height, label]);
    });
  });

  return { elem_ctr_points, all_elems };
}

function calculateArea(bbox) {
  // Calculate the area of the bounding box
  const width = bbox[2];
  const height = bbox[3];
  return width * height;
}

// Function to calculate center point of a bounding box
function calculateCenter(x, y, width, height) {
  const centerX = x + (width / 2);
  const centerY = y + (height / 2);
  return { centerX, centerY };
}

// Function to check if center of an element is inside another element's bounding box
function isInside(containerBbox, elementCenter) {
    const [x, y, width, height] = containerBbox;
    return elementCenter.centerX >= x && elementCenter.centerX <= (x + width) &&
           elementCenter.centerY >= y && elementCenter.centerY <= (y + height);
}

function sortDetectedElements(inf_resp) {
  // List of elements sorted by importance
  const elemImpList = [
      'Popup',
      'Alert Notification',
      'Video',
      'Advertisement',
      'Logo',
      'Captcha',
      'Toggle Button',
      'Checkbox',
      'Button',
      'Input Box'
  ];

  // Create a deep copy of the input response to avoid modifying the original inf_resp
  let cloned_inf_resp = JSON.parse(JSON.stringify(inf_resp));

  // Sort annotations within each image in the cloned response
  cloned_inf_resp.forEach(image => {
      // First, classify elements by whether they are containers or checkable/clickable elements
      const containers = [];
      const checkableClickable = [];

      image.annotations.forEach(annotation => {
          const category = annotation.category_id;

          // Identify containers: Popup, Alert Notification, Video, Advertisement, Logo, Captcha
          if (['Popup', 'Alert Notification', 'Video', 'Advertisement', 'Logo', 'Captcha'].includes(category)) {
              containers.push(annotation);
          }

          // Identify checkable/clickable: Button, Toggle Button, Checkbox
          if (['Button', 'Toggle Button', 'Checkbox'].includes(category)) {
              checkableClickable.push(annotation);
          }
      });

      // Sort containers by importance, and within the same importance, by area (largest first)
      containers.sort((a, b) => {
          const importanceA = elemImpList.indexOf(a.category_id);
          const importanceB = elemImpList.indexOf(b.category_id);

          if (importanceA === importanceB) {
              const areaA = calculateArea(a.bbox);
              const areaB = calculateArea(b.bbox);
              return areaB - areaA;  // Larger area first
          }
          return importanceA - importanceB;
      });

      // Sort checkable/clickable elements by importance, and within the same importance, by area (largest first)
      checkableClickable.sort((a, b) => {
          const importanceA = elemImpList.indexOf(a.category_id);
          const importanceB = elemImpList.indexOf(b.category_id);

          if (importanceA === importanceB) {
              const areaA = calculateArea(a.bbox);
              const areaB = calculateArea(b.bbox);
              return areaB - areaA;  // Larger area first
          }
          return importanceA - importanceB;
      });

      // Final sorted list of annotations
      const sortedAnnotations = [];

      // Insert containers, and then insert the clickable/checkable elements inside them, if any
      containers.forEach(container => {
          sortedAnnotations.push(container);

          // For each container, check which buttons, toggle buttons, or checkboxes are inside
          const containerCenter = calculateCenter(container.bbox[0], container.bbox[1], container.bbox[2], container.bbox[3]);
          checkableClickable.forEach(clickable => {
              const clickableCenter = calculateCenter(clickable.bbox[0], clickable.bbox[1], clickable.bbox[2], clickable.bbox[3]);
              
              // Check if the clickable element's center is inside the container
              if (isInside(container.bbox, clickableCenter)) {
                  sortedAnnotations.push(clickable);
              }
          });
      });

      // Add any remaining checkable/clickable elements that weren't inside any container
      checkableClickable.forEach(clickable => {
          if (!sortedAnnotations.includes(clickable)) {
              sortedAnnotations.push(clickable);
          }
      });

      // Update the image's annotations with the sorted list
      image.annotations = sortedAnnotations;
  });

  return cloned_inf_resp;  // Return the updated (sorted) object
}

// Function to capture screenshot and send inference request
async function processDomain(url, browser_options) {

  let browser;
  let inf_resp;
  let sorted_inf_resp;

  try {
    // Launch browser
    browser = await puppeteer.launch(browser_options);
    const page = await browser.newPage();

    // Set the viewport to 1920x1080
    await page.setViewport({
      width: 1920, 
      height: 1080
    });

    // Go to the page and wait for it to be fully loaded
    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2'  // Ensures the page is fully loaded
    });

    await sleep(5000)

    console.log('Page loaded, taking screenshot...');

    // Take a screenshot
    const screenshotBuffer = await page.screenshot({path: './logs/images/ss1.png'});

    console.log('Screenshot taken, sending inference request...');

    // Send the screenshot buffer and domain name to the inference service
    inf_resp = await sendInferenceRequest(screenshotBuffer, url);
    sorted_inf_resp = sortDetectedElements(inf_resp);

    const jsonDir = './json_log';
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir);
    }

    const jsonOutPath = path.join(jsonDir, `${sterilizeUrl(url)}_${getCurrentTimestamp()}.json`);

    fs.writeFileSync(jsonOutPath, JSON.stringify(sorted_inf_resp, null, 4), 'utf8');
    console.log(`JSON output saved to ${jsonOutPath}`);

    // console.log('Inference response:', JSON.stringify(inf_resp, null, 2));
    // console.log('Sorted inference response:', JSON.stringify(sorted_inf_resp, null, 2));

  } catch (error) {
    // Catch any errors that occur during the process and log them
    console.error('Error in processDomain:', error);

  } finally {
    // Ensure the browser is closed even if an error occurs
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }

  // Return the inference response
  return sorted_inf_resp;
}

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

async function load_page() {

  var CSV_results = await utils.CSVGetData() //load popularity ranking to the memory
  config.log.info("Starting date is:" + config.starting_date)

  var rand_viewports = config.USER_AGENTS[config.agent_name]["window_size_cmd"]

  var width = rand_viewports.slice(-1)[0][0]
  var height = rand_viewports.slice(-1)[0][1]
  config.log.info("The initial widthxheight is:" + width + "x" + height)

  var default_ss_size = `(${width},${height})`

  function getRanking(url_s) {
    var url_s = utils.canonical_url(url_s)
    url_s = url_s.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
    var line = CSV_results.filter(d => d.Website == url_s);
    config.log.info("Record found in csv and the line is:", line)
    if (line.length == 0) {
      return 100000
    } else {
      var ranking = line[0]["Ranking"]
      return ranking
    }

  }

  var count = 0

  var netlogfile = path.resolve(config.NET_LOG_DIR + config.starting_date_unix + "_siteID:" + config.id) + '.json'

  const args = [
    // '--headless',
    '--hide-scrollbars',
    '--mute-audio',
    // '--dns-log-details',
    // '--net-log-capture-mode=Everything',
    // `--log-net-log=${netlogfile}`,
    // '--single-process',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',
    // '--window-position=0,0',
    '--ignore-certificate-errors',
    // `--ignore-certificate-errors-spki-list=${path.resolve('/home/irfan/.mitmproxy/mitmproxy-ca.pem')}`,
    // '--ignore-certificate-errors-spki-list',
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--disable-features=IsolateOrigins",
    "--disable-site-isolation-trials",
    "--allow-popups-during-page-unload",
    "--disable-popup-blocking",
    // '--disable-dev-shm-usage',
    // '--enable-blink-features=HTMLImports',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    `--user-agent=${config.USER_AGENTS[config.agent_name]["user_agent"]}`,
    `--use-mobile-user-agent=${config.USER_AGENTS[config.agent_name]["mobile"]}`,
    '--shm-size=3gb',
    `--user-data-dir=${config.home_dir}chrome_user/`,
    //  `--user-data-dir=`,
    // '--proxy-server=localhost:8089'
    // `--proxy-server=localhost:${server.port}`
  ];
  config.logger_coor.info(`\nResolution used to calculate:${width}x${height}\n`)

  const browser_options = {
    headless: false,
    args,
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: width,
      height: height,
      deviceScaleFactor: config.USER_AGENTS[config.agent_name]["device_scale_factor"],
      devtools: true,
    },
  };
  
  await puppeteer.launch(browser_options).then(async browser => {

    async function findElementByCoordinates(page, ss_name, x, y, b_height, b_width) {
      // Calculate center of the bounding box
      const { centerX, centerY } = calculateCenter(x, y, b_width, b_height);

      // Retrieve the element at the center point and its bounding box info
      let chosenElement = await page.evaluate((centerX, centerY) => {
        // Get the element with the highest Z-index or the element that would be interacted with at the center
        let elements = document.elementsFromPoint(centerX, centerY);
        let element = elements[0];  // Assuming the first element is the one to interact with

        let sibArr = Array.from(element.parentNode.children).filter(i => i.tagName === element.tagName);
        let description;

        if (sibArr.indexOf(element) > 0) {
          let elementIndex = sibArr.indexOf(element);
          description = `${element.tagName.toLowerCase()}:nth-child(${elementIndex + 1})`;
        } else if (element.id) {
          description = `#${element.id}`;
        } else if (element.className) {
          description = `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`;
        } else {
          description = element.tagName.toLowerCase();
        }

        // Retrieve bounding box details
        let boundRect = element.getBoundingClientRect();
        return {
          description: description,
          boundingBox: {
            height: boundRect.height,
            width: boundRect.width,
            x: boundRect.x,
            y: boundRect.y,
            right: boundRect.right,
            bottom: boundRect.bottom
          }
        };
      }, centerX, centerY);

      let reason = "Detected by PP system visual inspection";

      // Log the necessary information
      config.logger_coor.info(`image_name: ${ss_name}\nclicking_coordinates: (${centerX},${centerY})\nchosen_element: ${chosenElement.description}\nreason to click: ${reason}\nBounding Box Coordinates: Box_height:${chosenElement.boundingBox.height} Box_width:${chosenElement.boundingBox.width} Box_x:${chosenElement.boundingBox.x} Box_y:${chosenElement.boundingBox.y} Box_right:${chosenElement.boundingBox.right} Box_bottom:${chosenElement.boundingBox.bottom}\n\n`);

      // Prepare return values
      var click_coordinates = {
        "x": centerX,
        "y": centerY
      };
      var el_description = chosenElement.description;
      var el_bounding_box = {
        "height": chosenElement.boundingBox.height,
        "width": chosenElement.boundingBox.width,
        "x": chosenElement.boundingBox.x,
        "y": chosenElement.boundingBox.y,
        "right": chosenElement.boundingBox.right,
        "bottom": chosenElement.boundingBox.bottom
      };

      // Return object with description, reason, bounding box, and click coordinates
      return {
        'description': el_description,
        "reason_to_click": reason,
        'bounding_box': el_bounding_box,
        'click_coordinates': click_coordinates
      };
    }

    async function clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, agent_name, visited_URLs, PAGE_LOAD_TIMEOUT_TABS, is_mobile, first_time, previous_url, previous_url_id, json_object_before, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab) {
      console.log("running clickFiveTimes...")
      config.log.info("totaltabcount_sess:" + totaltabcount_sess)
      if (first_time == true) {
        var ss_success_page_next = false
      } else {
        var ss_success_page_next = true
      }

      url_next = page_next.url()

      // ### Calling model API 1

      let raw_elem_json = await processDomain(url_next, browser_options)
      let { elem_ctr_points, all_elems } = parseJsonToTabs(raw_elem_json)

      var c = ((elem_ctr_points.length > 5) ? 5 : elem_ctr_points.length);
      config.log.info("elem_ctr_points", elem_ctr_points)
      config.log.info("------------------------------------------------")
      config.log.info("all_select_elements", all_select_elements)
      config.log.info("clickFiveTimes starts from here")

      if (elem_ctr_points.length != 0) {
        console.log("before assigning object:" + JSON.stringify(json_object_before))

        try {
          var element_obj = await findElementByCoordinates(page_next, json_object_before.screenshot_name, all_elems[0][0], all_elems[0][1], all_elems[0][2], all_elems[0][3]) //The first json object does not have calculated elementobj
        } catch (err) {
          config.log.error("Error1 in findElementByCoordinates: " + err)

        }

        // json_object_before = Object.assign(json_object_before,element_obj);
        json_object_before.element_clicked = element_obj
        // json_object_before.element_clicked.screenshot_before_name=
        // json_object_before.element_clicked.screenshot_after_name=
        console.log("after assigning object:" + JSON.stringify(json_object_before))

        for (const i in elem_ctr_points) {

          var url_tab_now = page_next.url()
          if (await page_next.isClosed()) {
            config.log.error("page_next is closed returning")
            return [visited_URLs, totaltabcount_sess, ss_success_page_next]
          }
          if (i == c) {
            break;
          }
          if (url_tab_now != url_next) {
            await page_next.goto(url_next, { waitUntil: 'networkidle2' });
            // await waitTillHTMLRendered(page_next)
          }

          if (i != 0) {
            if (i == 1) {
              previous_url = json_object_before.url
              previous_url_id = json_object_before.url_id
            } else {
              previous_url = json_object.url
              previous_url_id = json_object.url_id
            }

            if (first_time == true) {
              var tab_location = 'newBC' + i
            } else {
              var tab_location = 'newNEXTBC' + i
            }

            var json_object = await resizeandTakeScreenshot(page_next, page_next.url(), tab_location, true, all_elems[i])
            if (json_object.screenshot_success == false) {
              config.log.error("SCREENSHOT ERROR!! in clickFiveTimes beforeclick url_next:" + url_next)

              if (await page_next.isClosed()) {
                config.log.error("page_next is closed in clickFiveTimes beforeclick")
                return [visited_URLs, totaltabcount_sess, ss_success_page_next]

              } else {
                config.log.error("page_next in clickFiveTimes beforeclick is not closed but there is a screenshot error")
              }
            } else if (json_object.screenshot_success == "empty") {
              config.log.error("page_next in clickFiveTimes beforeclick in is an empty page (has not body element)")
              continue

            }
          }

          var html_before = await page_next.evaluate(() => {
            var html = document.body.innerHTML
            return html
          })
          var html_changed = false

          var xCoord = elem_ctr_points[i][0]
          var yCoord = elem_ctr_points[i][1]

          console.log(1, 'click coordinates:', xCoord, yCoord)

          // ### Code to show where on page is clicked

          await page.evaluate((xCoord, yCoord) => {
            const dot = document.createElement('div')
            dot.style.position = 'absolute'
            dot.style.left = `${xCoord + window.scrollX - 5}px`
            dot.style.top = `${yCoord + window.scrollY - 5}px`
            dot.style.width = '20px' // Larger size
            dot.style.height = '20px'
            dot.style.backgroundColor = 'red' // Brighter color
            dot.style.border = '3px solid yellow' // Adding a border
            dot.style.borderRadius = '50%'
            dot.style.zIndex = '999999' // Ensure it is the top-most element
            dot.style.boxShadow = '0 0 10px 5px rgba(255, 0, 0, 0.5)'; // Glowing shadow
            dot.style.pointerEvents = 'none' // Allow interaction with underlying elements
            dot.style.animation = 'pulse 0.25s infinite' // Pulsing animation

            document.body.appendChild(dot) // Ensure it's the last element
            setTimeout(() => {
              dot.remove()
            }, 3000) // Removes the dot after 3 seconds
          }, xCoord, yCoord)

          await page.waitForTimeout(3000)

          if (is_mobile) {
            await page.touchscreen.tap(xCoord, yCoord)
          } else {
            await page.mouse.move(xCoord, yCoord)
            await page.waitForTimeout(500)
            await page.mouse.down()
            await page.waitForTimeout(150)
            await page.mouse.up()
          }

          await page_next.waitForTimeout(config.AFTER_CLICK_WAIT)

          var html_after = await page_next.evaluate(() => {
            var html = document.body.innerHTML
            return html
          })

          const url_next_next = page_next.url()
          if (url_next == url_next_next && html_after != html_before) {


            if (first_time == true) {
              var tab_location = 'newAC' + i
            } else {
              var tab_location = 'newNEXTAC' + i
            }

            var json_object2 = await resizeandTakeScreenshot(page_next, page_next.url(), tab_location, false, "")
            if (i == 0) {
              // var json_success4=await utils.json_log_append(config.json_file,json_object2,json_object_before,previous_url,previous_url_id)
              var json_success4 = await utils.json_log_append(config.json_file, json_object2, json_object_before, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              ss_success_page_next = true
              config.log.info(json_success4)
            } else {
              // var json_success4=await utils.json_log_append(config.json_file,json_object2,json_object,previous_url,previous_url_id)
              var json_success4 = await utils.json_log_append(config.json_file, json_object2, json_object, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              config.log.info(json_success4)
            }

            var html_changed = true

            if (json_object2.screenshot_success == false) {

              config.log.error("SCREENSHOT ERROR!! in clickFiveTimes in newTABafterclick,url_next is:" + url_next)
              if (await page_next.isClosed()) {
                config.log.error("page_next in clickFiveTimes has been closed itself, exiting the function")
                return [visited_URLs, totaltabcount_sess, ss_success_page_next]
                //added
              } else {
                config.log.info("page_next in clickFiveTimes is not closed but there is a screenshot error")
              }


            } else if (json_object2.screenshot_success == "empty") {
              config.log.error("page_next in clickFiveTimes is an empty page (has not body element) continuing")
              continue
            }

          } else if (url_next != url_next_next) { //tab can also change after click

            if (html_changed == false && i == 0) {
              var json_success4 = await utils.json_log_append(config.json_file, null, json_object_before, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              ss_success_page_next = true
              config.log.info(json_success4)

            } else if (html_changed == false && i != 0) {
              var json_success4 = await utils.json_log_append(config.json_file, null, json_object, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              config.log.info(json_success4)
            }
            var rank = getRanking(url_next_next)
            if (!(utils.hasVisited(visited_URLs, url_next_next) || utils.calculate(rank))) {
              visited_URLs.add(url_next_next)
              if (config.crawler_mode == "SE") {
                var different = utils.is_reg_dom_different(url_first_tab, url_next_next)
                // console.log("the URL on the"+ tab_count1 +". tab is:"+url_next)
                if (different) {
                  config.log.info("early stop rule activated in clickFiveTimes..." + url_next_next)
                  early_stop = true
                }
              }

              var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_next_next)
              config.log.info(i + ".click out leads to the url in same tab in clickFiveTimes, url is:" + url_next_next)
              await waitTillHTMLRendered(page_next, PAGE_LOAD_TIMEOUT_TABS)

              if (first_time == true) {
                var tab_location = 'newSAME' + i
              } else {
                var tab_location = 'newNEXTSAME' + i
              }
              var json_object3 = await resizeandTakeScreenshot(page_next, url_next_next, tab_location, false)
              if (i == 0) {
                var json_success3 = await utils.json_log_append(config.json_file, null, json_object3, json_object_before.url, json_object_before.url_id, config.tab_loc_same, totaltabcount_sess_before, visit_id_tab + (new Date().getTime()))
              } else {
                var json_success3 = await utils.json_log_append(config.json_file, null, json_object3, json_object.url, json_object.url_id, config.tab_loc_same, totaltabcount_sess_before, visit_id_tab + (new Date().getTime()))
              }

              config.log.info(json_success3)
              if (json_object3.screenshot_success == false) {

                config.log.error("SCREENSHOT ERROR!! in clickFiveTimes in newTABsame url_next_next:" + url_next_next)
                if (await page_next.isClosed()) {
                  config.log.error("page_next in clickFiveTimes has been closed itself after the URL was changed by click, exiting the function")
                  return [visited_URLs, totaltabcount_sess, ss_success_page_next]

                } else {
                  config.log.error("page_next in clickFiveTimes in newTABsame is not closed but there is a screenshot error")
                }
              } else if (json_object3.screenshot_success == "empty") {
                config.log.error("page_next in clickFiveTimes in newTABsame is an empty page (has not body element)")

              }

            }
            else {
              config.log.info(i + ".url has in newTABsame been visited before or filtered,or the url has a ranking that is lower than the threshold, rank:" + rank + " the url_next_next is :" + url_next_next)

            }

          } else {

            config.log.info("clicked. But page has not changed. in clickFiveTimes function")
            if (html_changed == false && i == 0) {
              var json_success4 = await utils.json_log_append(config.json_file, null, json_object_before, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              ss_success_page_next = true
              config.log.info(json_success4)

            } else if (html_changed == false && i != 0) {
              var json_success4 = await utils.json_log_append(config.json_file, null, json_object, previous_url, previous_url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
              config.log.info(json_success4)
            }
          }

          //visit other tabs opened by the ads and take screenshots of them and then close
          await page_next.waitForTimeout(config.WAIT_NEW_TAB_LOAD)
          var tabCountClickedAfterClicks = (await browser.pages()).length

          while (tabCountClickedAfterClicks > tabCountClicked) {
            totaltabcount_sess = totaltabcount_sess + 1
            var visit_id_tab_tab = visit_id_tab + (new Date().getTime())

            try {

              config.log.info("New page opened in new new tab in ClickFiveTimes after " + i + ". click")
              var page_next_next = (await browser.pages())[tabCountClickedAfterClicks - 1]

              var count2 = 0
              var trigger_tab2 = await setInterval(async function () {
                // close the browser if the run exfceeds timeout interval
                if (count2 >= config.the_tab_interval2) {

                  console.log('TAB TIMEOUT...closing the tab')
                  clearInterval(trigger_tab2);
                  // tabCountClickedAfterClicks=tabCountClickedAfterClicks-1

                  try {
                    await page_next_next.close()
                  } catch (err) {
                    config.log.error("Error16" + err)
                  }
                  return

                }
                count2 = count2 + wait_interval
              }, wait_interval);

              if (page_next_next.isClosed()) {
                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
                clearInterval(trigger_tab2);
                continue
              }

              await waitTillHTMLRendered(page_next_next)
              const url_next_next = page_next_next.url()
              config.log.info("the url of that new tab is (url_next_next):", url_next_next)

              if (!utils.isValidHttpUrl(url_next_next)) {
                config.log.info("INVALID URL CLOSING THE TAB, URL IS:" + url_next_next)
                await page_next_next.close()
                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
                clearInterval(trigger_tab2);

                continue

              }

              if (url_next_next == "about:blank" || url_next_next == "") {
                config.log.info("empty tab..closing the tab")
                await page_next_next.close()
                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
                clearInterval(trigger_tab2);

                continue
              }

              // var rank=20000
              var rank = getRanking(url_next_next)
              if (utils.hasVisited(visited_URLs, url_next_next) || utils.calculate(rank)) {
                config.log.info("the url of that new tab next is (url_next_next) has been visited before or ranking is lower than the threshold closing, the url is:", url_next_next)
                config.log.info("ranking is:", rank)
                await page_next_next.close()
                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
                clearInterval(trigger_tab2);

                continue
              }

              visited_URLs.add(url_next_next)
              if (config.crawler_mode == "SE") {
                var different = utils.is_reg_dom_different(url_first_tab, url_next_next)
                // console.log("the URL on the"+ tab_count1 +". tab is:"+url_next)
                if (different) {
                  config.log.info("early stop rule activated inclickfivetimes2..." + url_next_next)
                  early_stop = true
                }
              }

              var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_next_next)

              if (first_time == true) {
                var tab_location = 'newNEW' + i
              } else {
                var tab_location = 'newNEWNEXT' + i
              }

              var json_object4 = await resizeandTakeScreenshot(page_next_next, url_next_next, tab_location, false, "")

              if (i == 0) {
                var json_success3 = await utils.json_log_append(config.json_file, null, json_object4, json_object_before.url, json_object_before.url_id, config.tab_loc_newTAB, totaltabcount_sess, visit_id_tab_tab)
              } else {
                var json_success3 = await utils.json_log_append(config.json_file, null, json_object4, json_object.url, json_object.url_id, config.tab_loc_newTAB, totaltabcount_sess, visit_id_tab_tab)
              }
              config.log.info(json_success3)

              if (json_object4.screenshot_success == false) {
                config.log.error("SCREENSHOT ERROR!! in clickFiveTimes in newTABnext url_next_next:" + url_next_next)

                if (await page_next_next.isClosed()) {
                  config.log.error("page_next_next is closed in clickFiveTimes")
                  tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
                  clearInterval(trigger_tab2);

                  continue

                } else {
                  config.log.error("page_next_next in clickFiveTimes in newTABnext is not closed but there is a screenshot error")

                }
              } else if (json_object4.screenshot_success == "empty") {

                config.log.error("page_next_next in clickFiveTimes in newTABnext is an empty page (has not body element)")

              }

              await page_next_next.close()
              tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
              clearInterval(trigger_tab2);
            } catch (err) {

              config.log.error("Error1:" + err)
              if (await page_next_next.isClosed()) {

                console.log("already closed3")
                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1

              } else {

                console.log("not closed; closing3")

                try {
                  await page_next_next.close()
                } catch (err) {

                  config.log.error("Error2:" + err)
                }


                tabCountClickedAfterClicks = tabCountClickedAfterClicks - 1
              }

              clearInterval(trigger_tab2);

            }
          }

          if (first_time == true) { //call recursively
            url_tab_now = page_next.url()
            // if(url_tab_now==url_next && html_after!=html_before )
            if (url_tab_now == url_next && html_changed == true) {
              config.log.info("After the click in the new tab, the new tab's url has not changed but its html changed...calling clickFiveTimes again")
              try {
                if (i == 0) {
                  var [early_stop, visited_URLs, totaltabcount_sess, ss_success_page_next] = await clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, config.agent_name, visited_URLs, config.PAGE_LOAD_TIMEOUT_TABS, is_mobile, false, json_object_before.url, json_object_before.url_id, json_object2, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab + (new Date().getTime()))
                } else {
                  var [early_stop, visited_URLs, totaltabcount_sess, ss_success_page_next] = await clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, config.agent_name, visited_URLs, config.PAGE_LOAD_TIMEOUT_TABS, is_mobile, false, json_object.url, json_object.url_id, json_object2, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab + (new Date().getTime()))
                }

              } catch (err) {
                config.log.error("error in clickFiveTimes for new tab closing tab:" + err)
              }
              await page_next.goto(url_next, { waitUntil: 'networkidle2' });

            }

          }

        }

      }

      config.log.info("clickFiveTimes ended here")
      return [early_stop, visited_URLs, totaltabcount_sess, ss_success_page_next]
    }

    async function resizeandTakeScreenshot(page_next, url_i, tab_loc, isClickableTab, all_elems) {
      const contains_body = await page_next.evaluate(() => {


        if (document.body != null && document.body.innerHTML.replace(/^\n|\n$/g, '').trim() != '<h1>Disabled</h1>' && document.body.innerHTML.replace(/^\n|\n$/g, '').trim() != 'Session is invalid or expired.') {
          const body = document.body.contains(document.getElementsByTagName("body")[0])
          return body
        } else {
          console.log("here in empty body")

          return false
        }

      })
      if (contains_body == true) {
        console.log("")

      } else {
        console.log("THERE IS NO BODY ELEMENT IN THE PAGE")
        var time_ss = new Date().getTime()
        var url_id = utils.url_hasher(url_i, time_ss)
        return { 'time': time_ss, 'screenshot_success': "empty", 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }
      }
      var url_hash = utils.single_url_hasher(url_i)
      var unix_time = new Date().getTime()
      var screenshot_name = config.SCREENSHOT_DIR + unix_time + "_" + url_hash + "_" + tab_loc
      var mhtml_name = config.HTML_LOGS_DIR + unix_time + "_" + url_hash + "_" + tab_loc
      var url_id = utils.url_hasher(url_i, unix_time)

      try {
        const cdp = await page_next.target().createCDPSession();
        const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
        fs.writeFileSync(mhtml_name + ".mhtml", data);
      } catch (err) {
        config.log.error("In capturesnapshot error:" + err)
        config.log.error("The url is:" + url_i)
      }

      if (await page_next.isClosed()) {
        config.log.error("Page is closed unexpectedly in resizeAndScreenshot function. Url is:" + url_i)
        return { 'time': unix_time, 'screenshot_success': false, 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }

      }

      if (config.USER_AGENTS[config.agent_name]["mobile"] == true) {
        var ss_name = screenshot_name + '_' + width + "x" + height + '.png'

        try {
          await Promise.race([page_next.screenshot({ path: ss_name, type: 'png' }), new Promise((resolve, reject) => setTimeout(reject, 180000))]);

        } catch (err) {
          config.log.error("Error during taking screenshot. Url is:" + url_i)
          config.log.error("error is:" + err)
          return { 'time': unix_time, 'screenshot_success': false, 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }

        }

        if (isClickableTab == true) {
          try {
            var element_obj = await findElementByCoordinates(page_next, ss_name, all_elems[0], all_elems[1], all_elems[2], all_elems[3])
          } catch (err) {
            config.log.error("Error2 in findElementByCoordinates: " + err)

          }

        }
        if (config.USER_AGENTS[config.agent_name]["window_size_cmd"].length > 0) { // landscape resolution for the tablet
          var width_land = config.USER_AGENTS[config.agent_name]["window_size_cmd"][0]
          var height_land = config.USER_AGENTS[config.agent_name]["window_size_cmd"][1]
          var ss_name_land = screenshot_name + '_' + width_land + "x" + height_land + '.png'
          try {
            await page_next.setViewport({ width: width_land, height: height_land })
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)
            await Promise.race([page_next.screenshot({ path: ss_name_land, type: 'png' }), new Promise((resolve, reject) => setTimeout(reject, 180000))]);

          } catch (err) {
            config.log.error("Error during taking screenshot. Url is:" + url_i)
            config.log.error("error is:" + err)

          }

        }
        if (!(await page_next.isClosed())) {
          try {
            await page_next.setViewport({ width: width, height: height })
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)
          } catch (err) {
            console.log.error("error in setting default resolution:" + err)

          }

        }
        config.log.info("screenshot_name in resize:" + ss_name)
        if (isClickableTab == true) {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': element_obj }
        } else {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': null }
        }


      } else {

        const rand_viewports = config.USER_AGENTS[config.agent_name]["window_size_cmd"]

        config.log.info("rand_viewports are used to take desktopscreenshots:" + rand_viewports)

        for (const q in rand_viewports) {

          var width1 = rand_viewports[q][0]
          var height1 = rand_viewports[q][1]

          var ss_name = screenshot_name + '_' + width1 + "x" + height1 + '.png'

          try {
            await page_next.setViewport({ width: width1, height: height1 })
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)

            console.log("just before taking screenshot desktop")
            // time_ss=new Date().getTime()
            await Promise.race([page_next.screenshot({ path: ss_name, type: 'png' }), new Promise((resolve, reject) => setTimeout(reject, 180000))]);
            // await page_next.screenshot({ path:ss_name , type: 'png' });
          } catch (err) {
            config.log.error("Error during taking screenshot. Url is:" + url_i)
            config.log.error("error is:" + err)
            return { 'time': unix_time, 'screenshot_success': false, 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }
          }
          console.log("just after taking screenshot desktop")

        }

        try {

          if ((height != rand_viewports[0][1] || width != rand_viewports[0][0])) {  // we need to preserve the initial viewport size in the clickable tabs before clicks, because we calculated the coordinates of the clickable elements using the first default random viewport size
            var ss_name = screenshot_name + '_' + width + "x" + height + '.png'
            config.log.info(`Setting viewport to the default width,height:${width}${height}`)

            await page_next.setViewport({ width: width, height: height })  //setting viewport to the default viewport before continuing clicking
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)
            console.log("the last height in the sreenshot method is:" + rand_viewports[2][1])
            // time_ss=new Date().getTime()
            await Promise.race([page_next.screenshot({ path: ss_name, type: 'png' }), new Promise((resolve, reject) => setTimeout(reject, 180000))]);

          } else {

          }

          if (isClickableTab == true) {

            try {
              var element_obj = await findElementByCoordinates(page_next, ss_name, all_elems[0], all_elems[1], all_elems[2], all_elems[3])
            } catch (err) {
              config.log.error("Error3 in findElementByCoordinates: " + err)

            }

          }

        } catch (error) {
          config.log.error("Error during setting viewport to the default. Url is:" + url_i)
          config.log.error("error is:" + e)
          var url_id = utils.url_hasher(url_i, unix_time)
          return { 'time': unix_time, 'screenshot_success': false, 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }

        }
        config.log.info("image name:" + ss_name)
        //  return true

        var url_id = utils.url_hasher(url_i, unix_time)
        if (isClickableTab == true) {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': element_obj }
        } else {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': null }
        }

      }
    }

    const waitTillHTMLRendered = async (page, timeout = config.PAGE_LOAD_TIMEOUT) => {
      const checkDurationMsecs = 1000;
      const maxChecks = timeout / checkDurationMsecs;
      let lastHTMLSize = 0;
      let checkCounts = 1;
      let countStableSizeIterations = 0;
      const minStableSizeIterations = 3;

      while (checkCounts++ <= maxChecks) {

        const html = await page.evaluate(() => {
          if (document.body != null) {
            var html = document.body.innerHTML
            return html
          } else {
            return null
          }

        })

        if (html == null) {
          console.log("HERE IN WAITTILL")
          break
        }

        let currentHTMLSize = html.length;

        if (lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize)
          countStableSizeIterations++;
        else
          countStableSizeIterations = 0; //reset the counter

        if (countStableSizeIterations >= minStableSizeIterations) {
          console.log("Page rendered fully..");
          break;
        }

        lastHTMLSize = currentHTMLSize;
        await page.waitForTimeout(checkDurationMsecs);
      }
    };

    try {

      //  var the_interval = config.timeout *1000 //in milliseconds
      var the_interval = config.timeout//in milliseconds

      const listenPageErrors = async (page) => {
        // make args accessible
        const describe = (jsHandle) => {
          return jsHandle.executionContext().evaluate((obj) => {
            // serialize |obj| however you want
            return `OBJ: ${typeof obj}, ${obj}`;
          }, jsHandle);
        }

        // listen to browser console there
        page.on('console', async (message) => {
          var urll = await page.url()
          const args = await Promise.all(message.args().map(arg => describe(arg)));
          // make ability to paint different console[types]
          const type = message.type().substr(0, 3).toUpperCase();

          let text = '';
          for (let i = 0; i < args.length; ++i) {
            text += `[${i}] ${args[i]} `;
          }

          config.logger_chrm.info(`${utils.toISOLocal(new Date())}: url is:${urll} url ended \nCONSOLE.${type}: ${message.text()}\n${text}\n`);
        });
      }

      browser.on('targetcreated', async target => {

        if (target.type() == 'page') {
          try {


            var page = await target.page()
            await stealth.onPageCreated(page)

            await page.setDefaultNavigationTimeout(0)
            await page.setCacheEnabled(false)
            await listenPageErrors(page)
            await page._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });



            await page._client.send('Network.enable');
            // Document, Stylesheet, Image, Media, Font, Script, TextTrack, XHR, Fetch, EventSource, WebSocket, Manifest, SignedExchange, Ping, CSPViolationReport, Preflight, Other
            await page._client.send('Network.setRequestInterception', {
              patterns: [
                {
                  urlPattern: '*',
                  // resourceType: 'Script',
                  interceptionStage: 'HeadersReceived'
                }
              ]
            });

            page._client.on('Network.requestIntercepted', (({ interceptionId, request, isDownload, responseStatusCode, responseHeaders }) => {

              var requestt = '>> ' + request.method + " " + request.url + ' Timestamp:' + new Date() + '\n'
              var reqHeaders = "Request headers:" + JSON.stringify(request.headers, null, 2) + "\n"
              var requesttt = requestt.concat('\n', reqHeaders)
              config.logger_rr.info(requesttt)

              if (isDownload) {
                var resHeadersDownload = "Res headers for download:" + JSON.stringify(responseHeaders, null, 2) + "\n"
                console.log("IS download" + isDownload)
                config.log_download.info(requesttt)
                config.log_download.info(resHeadersDownload)
              }

              page._client.send('Network.continueInterceptedRequest', {
                interceptionId,
              });
            }));

            page._client.on('Network.responseReceived', ((res) => {
              var responseURLIP = '<< ' + res.response.status + " " + res.response.url + "  RemoteIP:" + res.response.remoteIPAddress + ' Timestamp:' + res.response.headers["date"] + '\n'
              var resHeaders = "Response headers:" + JSON.stringify(res.response.headers, null, 2) + "\n"
              var responses = responseURLIP.concat('\n', resHeaders)
              config.logger_rr.info(responses)
            }));
            page.on('dialog', async dialog => {
              console.log('dialog');
              await dialog.accept();

            });
            await page.evaluate(() => {

              console.clear = () => { }

            })

          }
          catch (err) {
            config.log.error("Error6:" + err)
          }

        }
      })
      const page = await browser.newPage(); //open new tab
      await (await browser.pages())[0].close(); //close first one, to overcome the bug in stealth library mentioned in
      //https://github.com/berstend/puppeteer-extra/issues/88
      var visited_URLs = new Set()
      var is_mobile = config.USER_AGENTS[config.agent_name]["mobile"]
      var wait_interval = 5000

      // checks if the timeout has exceeded every few seconds
      var trigger = await setInterval(async function () {

        // close the browser if the run exfceeds timeout interval
        if (count >= the_interval) {
          config.log.info(new Date(Date.now()).toLocaleString())
          config.log.info('visit ended,exiting program')

          clearInterval(trigger);
          //  await zipper_netlog(netlogfile)
          await process_ended(config.id, browser, netlogfile)

          return
        }
        count = count + wait_interval
      }, wait_interval);
      try {

        config.log.info('Crawling is started. Visiting page:' + config.url)
        config.log.info(`Crawler is running in ${config.crawler_mode} mode`)
        config.log.info("Browser version is:" + (await page.browser().version()))
        config.log.info("User agent is:" + config.USER_AGENTS[config.agent_name]["user_agent"])
        // var visit_time=new Date().getTime()
        var visit_id = 1
        var early_stop = false
        await page.goto(config.url, { waitUntil: 'networkidle2' });

        // await waitTillHTMLRendered(page)
        var url_first_tab = page.url()

        // ### Calling model API 2

        let raw_elem_json = await processDomain(url_first_tab)
        let { elem_ctr_points, all_elems } = parseJsonToTabs(raw_elem_json)

        var tabCount = (await browser.pages()).length
        // console.log("elem coords are:"+elem_ctr_points)
        var tab_location = "FIRST"
        var json_object = await resizeandTakeScreenshot(page, url_first_tab, tab_location, true, all_elems[0])
        visited_URLs.add(url_first_tab)

        var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_first_tab)

        if (json_object.screenshot_success == false) {
          config.log.error("SCREENSHOT ERROR!!, cannot take screenshot in url_first_tab, the url is:" + url_first_tab)

          if (!(await page.isClosed())) {
            config.log.info("Page is not closed")

          } else {
            config.log.error("error in screenshot; the landing page is closed")
            config.log.info("End time:" + new Date(Date.now()).toLocaleString())
            console.log('visit ended')
            clearInterval(trigger);
            // await zipper_netlog(netlogfile)
            await process_ended(config.id, browser, netlogfile)
            return
          }

        } else if (json_object.screenshot_success == "empty") {

          config.log.error("the page is empty(has not body element); does not have body element;exiting program")
          config.log.info("End time:" + new Date(Date.now()).toLocaleString())
          clearInterval(trigger);
          // await zipper_netlog(netlogfile)
          await process_ended(config.id, browser, netlogfile)
          return

        }
        var totaltabcount_sess = 1

        for (const i in elem_ctr_points) {

          config.log.info("CLICK COUNTER in the landing page:" + i)

          url_next = page.url()


          if (url_next != url_first_tab) {
            config.log.info("Landing url has changed, revisiting...")
            await page.goto(url_first_tab, { waitUntil: 'networkidle2' });
            // await waitTillHTMLRendered(page)

          }

          if (i != 0) {

            var tab_location = 'land' + i
            //  meeting
            json_object = await resizeandTakeScreenshot(page, page.url(), tab_location, true, all_elems[i])


            if (json_object.screenshot_success == false) {

              config.log.error("SCREENSHOT ERROR!! in url:" + page.url())
              if (await page.isClosed()) {
                config.log.error("page has been closed itself, exiting the program")
                return


              } else {
                config.log.error("page is not closed but there is a screenshot error")

              }
            } else if (json_object.screenshot_success == "empty") {
              config.log.error("page is an empty page (has not body element) revisiting the page")
              await page.goto(url_first_tab, { waitUntil: 'networkidle2' });
              // await waitTillHTMLRendered(page)

            }

          }

          try {
            var html_before = await page.evaluate(() => {
              var html = document.body.innerHTML
              return html
            })
          } catch (err) {

            config.log.error("Error1 in evaluating document.body.innerHTML. Url is")
            config.log.error("error is:" + err)
            html_before = null

          }

          var html_changed = false

          var xCoord = elem_ctr_points[i][0]
          var yCoord = elem_ctr_points[i][1]

          console.log(2, 'click coordinates:', xCoord, yCoord)

          // ### Code to show where on page is clicked

          await page.evaluate((xCoord, yCoord) => {
            const dot = document.createElement('div')
            dot.style.position = 'absolute'
            dot.style.left = `${xCoord + window.scrollX - 5}px`
            dot.style.top = `${yCoord + window.scrollY - 5}px`
            dot.style.width = '20px' // Larger size
            dot.style.height = '20px'
            dot.style.backgroundColor = 'red' // Brighter color
            dot.style.border = '3px solid yellow' // Adding a border
            dot.style.borderRadius = '50%'
            dot.style.zIndex = '999999' // Ensure it is the top-most element
            dot.style.boxShadow = '0 0 10px 5px rgba(255, 0, 0, 0.5)'; // Glowing shadow
            dot.style.pointerEvents = 'none' // Allow interaction with underlying elements
            dot.style.animation = 'pulse 0.25s infinite' // Pulsing animation

            document.body.appendChild(dot) // Ensure it's the last element
            setTimeout(() => {
              dot.remove()
            }, 3000) // Removes the dot after 3 seconds
          }, xCoord, yCoord)

          await page.waitForTimeout(3000)

          if (is_mobile) {
            await page.touchscreen.tap(xCoord, yCoord);
          } else {
            await page.mouse.move(xCoord, yCoord);
            await page.waitForTimeout(500);
            await page.mouse.down();
            await page.waitForTimeout(150);
            await page.mouse.up();
          }

          await page.waitForTimeout(config.AFTER_CLICK_WAIT)

          var html_after = await page.evaluate(() => {
            var html = document.body.innerHTML
            return html
          })

          var url_next = page.url()

          if (url_next != url_first_tab) {
            var rank = getRanking(url_next)

            if (!(utils.hasVisited(visited_URLs, url_next) || utils.calculate(rank))) {
              visited_URLs.add(url_next)

              if (config.crawler_mode == "SE") {
                var different = utils.is_reg_dom_different(url_first_tab, url_next)
                // console.log("the URL on the"+ tab_count1 +". tab is:"+url_next)
                if (different) {
                  config.log.info("early stop rule activated in landing tab..." + url_next)
                  early_stop = true
                }
              }
              var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_next)

              await waitTillHTMLRendered(page, config.PAGE_LOAD_TIMEOUT_TABS)
              config.log.info("new page opened in the same tab.Visited URLs are not the same, the url_next is:", url_next)

              var tab_location = 'lsame' + i
              var json_object3 = await resizeandTakeScreenshot(page, url_next, tab_location, false, "")
              var json_success3 = await utils.json_log_append(config.json_file, null, json_object3, json_object.url, json_object.url_id, config.tab_loc_same, 1, visit_id + (new Date().getTime()))
              config.log.info(json_success3)

              if (json_object3.screenshot_success == false) {
                config.log.error("SCREENSHOT ERROR!! in url_next:" + url_next)
                if (await page.isClosed()) {
                  config.log.error("page has been closed itself after the URL was changed by click, exiting the program")
                  //closes the main tab
                  return
                  //ARE WE SUPPOSED TO RELAUNCH THE BROWSER?
                } else {

                  config.log.error("page is not closed but there is a screenshot error after the click")

                }
              } else if (json_object3.screenshot_success == "empty") {
                config.log.error("the landing page is an empty page(has not body element) after the click")

              }
            } else {
              config.log.info("this url has been visited before or filtered or has ranking lower than the threshold, rank: " + rank + "the url is:" + url_next)
            }
          } else if (url_next == url_first_tab && html_after != html_before) {
            var html_changed = true
            config.log.info("the first tab's url has not changed but its html changed...taking ss and visiting the page again")
            var tab_location = 'lafter' + i
            var json_object2 = await resizeandTakeScreenshot(page, url_next, tab_location, false, "")
            if (json_object2.screenshot_success == false) {

              config.log.error("SCREENSHOT ERROR!! in url:" + url_next)
              if (await page.isClosed()) {
                config.log.error("page has been closed itself, exiting the program")
                return
                //ARE WE SUPPOSED TO RELAUNCH THE BROWSER?
                //closes the main tab
              } else {
                config.log.error("page is not closed but there is a screenshot error")

              }
            } else if (json_object2.screenshot_success == "empty") {
              config.log.error("page is an empty page (has not body element) revisiting the page")
              await page.goto(url_first_tab, { waitUntil: 'networkidle2' });
              // await waitTillHTMLRendered(page)
              continue

            }

          }

          else {
            config.log.info("clicked, but page has not changed in landing page")

          }

          if (html_changed == true) {
            html_changed = false
            var json_success4 = await utils.json_log_append(config.json_file, json_object2, json_object, null, null, config.tab_loc_landing, 1, visit_id)
          } else {
            var json_success4 = await utils.json_log_append(config.json_file, null, json_object, null, null, config.tab_loc_landing, 1, visit_id)
          }
          config.log.info(json_success4)

          await page.waitForTimeout(config.WAIT_NEW_TAB_LOAD)
          var tabCountClicked = (await browser.pages()).length

          while (tabCountClicked != tabCount) {

            totaltabcount_sess = totaltabcount_sess + 1
            var visit_id_tab = visit_id + (new Date().getTime())
            var totaltabcount_sess_before = totaltabcount_sess

            try {
              config.log.info("New page opened in new tab,the amount of tabs are:" + tabCountClicked)
              var page_next = (await browser.pages())[tabCountClicked - 1]

              // checks if the timeout has exceeded every few seconds
              var count1 = 0
              var trigger_tab = await setInterval(async function () {
                // close the browser if the run exfceeds timeout interval
                if (count1 >= config.the_tab_interval) {

                  config.log.error('TAB TIMEOUT2...closing the tab')
                  clearInterval(trigger_tab);
                  try {
                    await page_next.close()
                  } catch (err) {
                    config.log.error("Error15 in tab:" + tabCountClicked + err)
                  }
                  return

                }
                count1 = count1 + wait_interval
              }, wait_interval);


              if (page_next.isClosed()) {
                tabCountClicked = tabCountClicked - 1
                clearInterval(trigger_tab);
                continue
              }

              await waitTillHTMLRendered(page_next)
              url_next = page_next.url()

              if (url_next == "about:blank" || url_next == "") {
                config.log.info("empty tab..skipping,the url is:" + url_next)
                tabCountClicked = tabCountClicked - 1
                await page_next.close()
                clearInterval(trigger_tab);
                continue
              }
              if (!utils.isValidHttpUrl(url_next)) {
                config.log.info("INVALID URL CLOSING, URL IS:" + url_next)
                tabCountClicked = tabCountClicked - 1
                await page_next.close()
                clearInterval(trigger_tab);
                continue

              }

              config.log.info("The URL in the new tab is:" + url_next)
              var rank = getRanking(url_next)

              if (utils.hasVisited(visited_URLs, url_next) || utils.calculate(rank)) {
                config.log.info("this url in the new tab has been visited before or has ranking lower than the threshold, rank: " + rank + "the url is:" + url_next)
                tabCountClicked = tabCountClicked - 1
                await page_next.close()
                clearInterval(trigger_tab);
                continue
              }

              visited_URLs.add(url_next)
              if (config.crawler_mode == "SE") {
                var different = utils.is_reg_dom_different(url_first_tab, url_next)
                // console.log("the URL on the"+ tab_count1 +". tab is:"+url_next)
                if (different) {
                  config.log.info("early stop rule activated in newtab..." + url_next)
                  early_stop = true
                }
              }
              var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_next)
              var tab_location = 'new' + i

              var json_object4 = await resizeandTakeScreenshot(page_next, url_next, tab_location, false, "")

              if (json_object4.screenshot_success == false) {
                config.log.error("SCREENSHOT ERROR!!,cannot take screenshot in new tab, url_next is:" + url_next)
                if (await page_next.isClosed()) {
                  config.log.error("page_next(the page in the new tab) is closed, continuing")
                  tabCountClicked = tabCountClicked - 1
                  clearInterval(trigger_tab);

                  continue

                } else {

                  config.log.error("page_next(the page in the new tab) is not closed but there is a screenshot error")
                  await page_next.close()
                  tabCountClicked = tabCountClicked - 1
                  clearInterval(trigger_tab);

                  continue


                }

              } else if (json_object4.screenshot_success == "empty") {
                config.log.error("the page_next is an empty page(has not body element),continuing")
                await page_next.close()
                tabCountClicked = tabCountClicked - 1
                clearInterval(trigger_tab);

                continue

              }

              console.log("before click 5 the tab count:" + tabCountClicked)

              //continue to click on in the ad opened in the new tab
              var ss_success_page_next = false
              try {
                console.log("TAB COUNT BEFORE VISITIN CLICKFIVETIMES:" + (await browser.pages()).length)
                var [early_stop, visited_URLs, totaltabcount_sess, ss_success_page_next] = await clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, config.agent_name, visited_URLs, config.PAGE_LOAD_TIMEOUT_TABS, is_mobile, true, json_object.url, json_object.url_id, json_object4, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab)
              } catch (err) {

                config.log.error("error in clickFiveTimes closing tab:" + err)
              }
              config.log.info(`ss_success_page_next is ${ss_success_page_next} in the url_next: ${url_next}`)

              if (ss_success_page_next == false) {
                var json_success4 = await utils.json_log_append(config.json_file, null, json_object4, json_object.url, json_object.url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
                config.log.info(json_success4)

              }

              if (await page_next.isClosed()) {
                console.log(tabCountClicked)
                console.log("already closed")
                tabCountClicked = tabCountClicked - 1

              } else {
                console.log(tabCountClicked)
                console.log("not closed; closing")
                await page_next.close()
                tabCountClicked = tabCountClicked - 1
              }

              clearInterval(trigger_tab);

            } catch (err) {

              config.log.error("Error3:" + err)
              if (await page_next.isClosed()) {
                console.log(tabCountClicked)
                console.log("already closed2")
                tabCountClicked = tabCountClicked - 1

              } else {
                console.log(tabCountClicked)
                console.log("not closed; closing2")
                try {
                  await page_next.close()
                } catch (err) {
                  config.log.error("Error4:" + err)
                }

                tabCountClicked = tabCountClicked - 1
              }

              clearInterval(trigger_tab);
            }

          }
          if (config.crawler_mode == "SE") {
            if (early_stop == true) {
              break
            }

          }
          var url_tab_now = page.url()
          if (url_tab_now == url_first_tab && html_after != html_before) {
            await page.goto(url_first_tab, { waitUntil: 'networkidle2' });
            // await waitTillHTMLRendered(page)
          }

          visit_id = visit_id + 1
        }

      }
      catch (err) {
        config.log.error("Error5:" + err)
        config.log.info('visit ended')
        config.log.info("Browser is closed")

        config.log.info("End time:" + new Date(Date.now()).toLocaleString())
        clearInterval(trigger);
        //await zipper_netlog(netlogfile)
        await process_ended(config.id, browser, netlogfile)

        return
      }

      config.log.info("CRAWLING PROCESS COMPLETED SUCCESSFULLY")
      console.log(new Date(Date.now()).toLocaleString())
      config.log.info("Browser is closed")

      clearInterval(trigger);
      //  await zipper_netlog(netlogfile)
      await process_ended(config.id, browser, netlogfile)

      return

    }
    catch (err) {
      config.log.error("an error happened during crawling:" + err)
      // await zipper_netlog(netlogfile)
      await process_ended(id, browser, netlogfile)
    }
  })
}

async function zipper_netlog(netlogfile) {
  try {

    var zipper = require('zip-local');

    var zipped_netlog_name = `${netlogfile}.zip`
    zipper.zip(netlogfile, function (error, zipped) {

      if (!error) {
        zipped.compress(); // compress before exporting

        var buff = zipped.memory(); // get the zipped file as a Buffer

        // or save the zipped file to disk
        // var zippedFileName=path.join(netlogfile,".zip")

        zipped.save(zipped_netlog_name, function (error) {
          if (!error) {
            console.log("netlog compression successfull !");
          } else {
            config.log.error("netlog compression error")
          }
        });
      }
    });

    fs.stat(netlogfile, function (err, stats) {
      // console.log(stats);//here we got all information of file in stats variable

      if (err) {
        return config.log.error("error in netlog file deletion1:" + err);
      }

      fs.unlink(netlogfile, function (err) {
        if (err) return config.log.error("error in netlog file deletion2:" + err);
        config.log.info('original netlog file deleted successfully after compression');
      });
    });

  } catch (err) {
    config.log.error("Error during compressing netlog file:" + err)

  }

}

async function process_ended(id, browser, netlogfile) {

  try {

    const page_download = await browser.newPage(); //open new tab
    await page_download.goto("chrome://downloads/ ", { waitUntil: 'load' });
    await page_download.waitForTimeout(2000)
    await page_download.screenshot({ path: config.DOWNLOADS_DIR + config.id + "_" + utils.toISOLocal(new Date()), type: 'png', fullPage: true });
    await page_download.waitForTimeout(2000)

    config.log.info("closing the download page")
    await page_download.close()

  } catch (err) {
    config.log.error("Error during download page")
    if (!(await page_download.isClosed())) {
      await page_download.close()
    }
  }

  config.log.info('crawl process ended ::' + id)

  config.log.info("browser closed")
  var endTime = new Date();
  var [hours, minutes, seconds] = utils.calculateRunningTime(startTime, endTime)
  config.log.info(`Session lasted ${hours} hours ${minutes} minutes ${seconds} seconds`)
  await browser.close()
  process.exit();
  return
}

// ### Main driver function

async function crawl_url() {

  try {
    config.log.info('crawling started :: ' + config.id)
    await load_page()

  }

  catch (error) {
    config.log.error("Error in craw_url function:" + error)
    process.exit()
  }

}

crawl_url();












