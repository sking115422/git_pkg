'use strict';
var startTime = new Date();
var utils = require('./utils');
var config = require('./config');
const fs = require('fs')
const path = require('path');
const { Console } = require('console');




// const { Console } = require('console');
// const { JSHandle } = require('puppeteer');
// TODO: Try to remove elements whose parentElement <a> tag or the tag itself (href) points to home page.
//Images that are larger than 900 sq. pixels in area will be placed at the beginning of
// the Action list. The idea is that images and as are more likely to lead to links than others.
// TODO: Try to remove elements whose parentElement <a> tag or the tag itself (href) points to home page.
//Images that are larger than 900 sq. pixels in area will be placed at the beginning of
// the Action list. The idea is that images and as are more likely to lead to links than others.



var IMG_PREFERENCE_THRESHOLD = 900
var SHORT_PAUSE = 5
const downloadPath = path.resolve(config.DOWNLOADS_DIR);


// //Tries to retain return elements with unique sizes, and unique mid-points
// //On some pages there are very close click-points that don't do anything different.
// //Hence we try to filter out elements that have spatially close click points.

// function calculate(rank) {
//   console.log("current rank:",rank)
//   if(config.crawler_mode=="SE"){
//       if(rank<config.tranco_threshold){
//          console.log("Rank is smaller than the threshold")
//          return true

//       }else{
//           console.log("Rank is bigger than the threshold")
//           return false

//       }

//   }else{
//       if(rank>=config.tranco_threshold){
//           console.log("Rank is bigger equal than threshold")
//           return true
//        }else{
//           console.log("Rank is smaller equal than threshold")
//            return false

//        }

//   }
// }



async function get_unique_elements(elems) {

  var skip_it = false
  var R = 100;  //Coarseness in pixels for determining unique click points
  var MAX_SAME_COORD = 2 //Don't allow more than 2 elements on same x or y coordinates.
  const ret_elems = []
  const prev_elems = new Set()  //Contains width and height of prev elements
  const prev_mid_points = new Set()
  const prev_x = new utils.DefaultDict(Number)
  const prev_y = new utils.DefaultDict(Number)
  var mp_rounded;
  for (const elem in elems) {

    for (let item of prev_elems.keys()) {
      if (item.toString() == [elems[elem][3], elems[elem][2]].toString())
        skip_it = true
      continue
      //true on match.
    }
    if (skip_it == true) {
      skip_it = false
      continue
    }
    const coords = [elems[elem][0], elems[elem][1]]

    mp_rounded = [utils.any_round(coords[0], R), utils.any_round(coords[1], R)]
    if (prev_mid_points.has(mp_rounded)) {
      continue;
    }
    for (let item of prev_mid_points.keys()) {
      if (item.toString() == mp_rounded.toString())
        skip_it = true
      continue
      //true on match.
    }
    if (skip_it == true) {
      skip_it = false
      continue
    }
    // prev_x doesn't make sense at all in pages where all different kinds of elements are vertically aligned
    //for example: https://onlinetviz.com/american-crime-story/2/1
    if (prev_y[elems[elem][1]] >= MAX_SAME_COORD) {
      continue;
    }
    //print "debug, unique size elems", elem.size['width'], elem.size['height']
    ret_elems.push(elems[elem])
    prev_elems.add([elems[elem][3], elems[elem][2]])
    prev_mid_points.add(mp_rounded)
    prev_x[elems[elem][0]] += 1
    prev_y[elems[elem][1]] += 1
  }

  return ret_elems
};




function element_area(elem) {
  return elem[2] * elem[3]
}



// //Given a list of elements, Sort the elements by area,
async function filter_elements(elems, imgs, width, height) {
  const rest_imgs = []
  const selected_imgs = []
  for (const img in imgs) {
    if (element_area(imgs[img]) > IMG_PREFERENCE_THRESHOLD) {
      selected_imgs.push(imgs[img])
    }
    else {
      rest_imgs.push(imgs[img])
    }
  }

  imgs = utils.sorted(selected_imgs, { key: x => x[2] * x[3], reverse: true })
  elems = elems.concat(rest_imgs)
  elems = utils.sorted(elems, { key: x => x[2] * x[3], reverse: true })
  elems = imgs.concat(elems)
  elems = await get_unique_elements(elems)
  elems = elems.slice(0, 20);
  const elem_coords = []
  for (const elem in elems) {
    elem_coords.push([elems[elem][0], elems[elem][1]])
  }

  if (elem_coords.length == 0) {
    //width, height = config.USER_AGENTS[agent_name]['window_size_cmd']
    var click_point = [width / 2, height / 2]
    // elem_coords.push([click_point])
    elem_coords.push(click_point)
    var click_point2 = [width / 2, height / 2, height, width, 0, 0, width, height, "unable to find element"]
    elems.push(click_point2)
  }
  return [elem_coords, elems]
  // return elem_coords
}

process.on('unhandledRejection', error => {
  // Prints "unhandledRejection woops!"
  //  config.log.error("unhandledRejection woops! error is:"+error)
  //  throw error;
  //  config.log.error("in:"+config.site_id+' :: '+config.url)
  //  child.kill('SIGINT')
  //  config.logger_rr.end()
  //  config.logger_chrm.end()
})





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
    // var line=utils.filterCSVResults(url_s,CSV_results)
    // config.log.info("Record found in csv and the line is:",url_s)
    config.log.info("Record found in csv and the line is:", line)
    if (line.length == 0) {
      return 100000
    } else {
      var ranking = line[0]["Ranking"]
      return ranking
    }

  }


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

  var count = 0

  //  const device_width = config.USER_AGENTS[agent_name]["device_size"][0]
  //  const device_height = config.USER_AGENTS[agent_name]["device_size"][1]

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


  const options = {
    // ignoreDefaultArgs: true,
    headless: false,
    args,
    // executablePath:home_dir+'chromium/src/out/Irfan/chrome',
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: width,
      height: height,
      deviceScaleFactor: config.USER_AGENTS[config.agent_name]["device_scale_factor"],
      devtools: true,
      // isMobile:config.USER_AGENTS[agent_name]["mobile"],
      // hasTouch:config.USER_AGENTS[agent_name]["mobile"],
      // isLandscape: config.USER_AGENTS[agent_name]["isLandscape"]
    },
    // userDataDir:config.home_dir+'chrome_user/',
    // dumpio: true
  };


  //  isLandscape: true



  await puppeteer.launch(options).then(async browser => {


    // return [midx, midy, boundRect.height, boundRect.width,boundRect.x,boundRect.y,boundRect.right,boundRect.bottom];
    async function findElementByCoordinates(page, ss_name, x, y, b_height, b_width, b_x, b_y, b_right, b_bottom, reason) {
      let chosenElement = await page.evaluate((x, y) => {
        return document.elementsFromPoint(x, y)
          .map((o) => {
            let sibArr = Array.from(o.parentNode.children).filter(i => i.tagName === o.tagName);
            if (sibArr.indexOf(o) > 0) {
              let oIndex = sibArr.indexOf(o);
              return `${o.tagName.toLowerCase()}:nth-child(${oIndex + 1})`;
            } else if (o.id) {
              return '#' + o.id;
            } else if (o.className) {
              return `${o.tagName.toLowerCase()}.${Array.from(o.classList).join('.')}`
            } else {
              return o.tagName.toLowerCase();
            }
          }).reverse().filter(e => !e.includes('html')).join(' > ');
      }, x, y);

      config.logger_coor.info(`image_name: ${ss_name}\nclicking_coordinates: (${x},${y})\nchosen_element: ${chosenElement}\nreason to click: ${reason}\nBounding Box Coordinates:Box_height:${b_height} Box_width:${b_width} Box_x:${b_x} Box_y:${b_y} Box_right:${b_right} Box_bottom:${b_bottom}\n\n`)
      var click_coordinates = {
        "x": x,
        "y": y
      }
      var el_description = chosenElement


      var el_bounding_box = { "height": b_height, "width": b_width, "x": b_x, "y": b_y, "right": b_right, "bottom": b_bottom }
      //  var el_bounding_box=`Box_height:${b_height} Box_width:${b_width} Box_x:${b_x} Box_y:${b_y} Box_right:${b_right} Box_bottom:${b_bottom}`
      return { 'description': el_description, "reason_to_click": reason, 'bounding_box': el_bounding_box, 'click_coordinates': click_coordinates }
    }


    async function clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, agent_name, visited_URLs, PAGE_LOAD_TIMEOUT_TABS, is_mobile, first_time, previous_url, previous_url_id, json_object_before, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab) {
      config.log.info("totaltabcount_sess:" + totaltabcount_sess)
      if (first_time == true) {
        var ss_success_page_next = false
      } else {
        var ss_success_page_next = true
      }

      var [elems_tab, imgs_tab] = await page_next.evaluate(() => {
        function elementDimensions(element, wHeight, wWidth, reason) {
          var boundRect = element.getBoundingClientRect();
          var midy = boundRect.top + (boundRect.height / 2.0);
          var midx = boundRect.left + (boundRect.width / 2.0);
          if (boundRect.height != 0 && boundRect.width != 0 &&
            midy < wHeight && midx < wWidth && midy > 0 && midx > 0)
            return [midx, midy, boundRect.height, boundRect.width, boundRect.x, boundRect.y, boundRect.right, boundRect.bottom, reason];
          // return [midx, midy, boundRect.height, boundRect.width];
          else
            return [];
        }
        // Args: an array of element objects, window height and window width
        // This function filters out elements that are
        // (1) of size 0
        // (2) Outside the viewport vertically or horizontally.
        // Returns a array of arrays
        function filterElementArrays(elements, wHeight, wWidth, reason) {
          var elem_sizes = [];
          for (var element of elements) {
            var elem = elementDimensions(element, wHeight, wWidth, reason);
            if (elem.length > 0)
              elem_sizes.push(elem);
          }
          return elem_sizes;
        }
        // Similar to filterElementArrays but takes xpathResult object as
        // one of the arguments
        function filterXpathResults(xpathResults, wHeight, wWidth, reason) {
          var elem_sizes = [];
          var element = xpathResults.iterateNext();
          while (element) {
            var elem = elementDimensions(element, wHeight, wWidth, reason);
            if (elem.length > 0)
              elem_sizes.push(elem);
            element = xpathResults.iterateNext();
          }
          return elem_sizes;
        }


        function getElementsByXpath(path) {
          var xpathres = document.evaluate(
            path, document, null,
            XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null);
          return xpathres;
        }


        // //Tries to retain return elements with unique sizes, and unique mid-points
        // //On some pages there are very close click-points that don't do anything different.
        // //Hence we try to filter out elements that have spatially close click points.

        function getElementData() {

          var wHeight = window.innerHeight;
          var wWidth = window.innerWidth;
          var element_data = [];
          var divs_xpath = getElementsByXpath('//div[not(descendant::div) and not(descendant::td)]');

          var divs = filterXpathResults(divs_xpath, wHeight, wWidth, "selected div (//div[not(descendant::div) and not(descendant::td)])");
          var tds_xpath = getElementsByXpath('//td[not(descendant::div) and not(descendant::td)]');
          var tds = filterXpathResults(tds_xpath, wHeight, wWidth, "selected td (//td[not(descendant::div) and not(descendant::td)])");
          var iframe_elems = document.getElementsByTagName('iframe');
          var iframes = filterElementArrays(iframe_elems, wHeight, wWidth, "selected iframe element");
          var a_elems = document.getElementsByTagName('a');
          var as = filterElementArrays(a_elems, wHeight, wWidth, "selected a element");
          element_data = element_data.concat(divs, tds);
          var img_elems = document.getElementsByTagName('img');
          var imgs = filterElementArrays(img_elems, wHeight, wWidth, "selected img element");
          var prefs = imgs.concat(as, iframes)
          return [element_data, prefs];
        }
        return getElementData()
      })
      var filtered_elements = await filter_elements(elems_tab, imgs_tab, width, height)

      // var  filtered_elements=await filter_elements(elems, imgs,width,height)
      var elem_coords_tab = filtered_elements[0]
      var all_elems_tab = filtered_elements[1]

      // console.log("FILTERED ELEMENTS:",filtered_elements)



      //click on text starts here

      // var select_elements=await page_next.evaluate(function(keywords){
      //  if(config.crawler_mode=="SE"){
      var [select_elements, all_select_elements] = await page_next.evaluate(function (keywords) {

        var matchingElementList = []
        var allMatchingElementList = []
        // Similar to filterElementArrays but takes xpathResult object as
        function elementDimensions(element, wHeight, wWidth, reason) {
          var boundRect = element.getBoundingClientRect();
          var midy = boundRect.top + (boundRect.height / 2.0);
          var midx = boundRect.left + (boundRect.width / 2.0);
          if (boundRect.height != 0 && boundRect.width != 0 &&
            midy < wHeight && midx < wWidth && midy > 0 && midx > 0)
            // return [midx, midy, boundRect.height, boundRect.width];
            return [midx, midy, boundRect.height, boundRect.width, boundRect.x, boundRect.y, boundRect.right, boundRect.bottom, reason];
          else
            return [];
        }
        // one of the arguments
        function filterXpathResults(xpathResults, wHeight, wWidth, reason) {
          var elem_sizes = [];
          var element = xpathResults

          var elem = elementDimensions(element, wHeight, wWidth, reason);
          if (elem.length > 0)
            elem_sizes.push(elem);


          return elem_sizes;
        }

        var xpath = ""

        var matchingElement = []
        var wHeight = window.innerHeight;
        var wWidth = window.innerWidth;

        for (const i in keywords) {
          // xpath = "//a[contains(text(),'Detecting Chrome Headless')]";
          // xpath = "//a[contains(text(),'"+keywords[i]+"')]";
          xpath = "//*[text()[contains(.,'" + keywords[i] + "')]]"
          matchingElement = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (matchingElement == null) {
            continue
          }
          matchingElement = filterXpathResults(matchingElement, wHeight, wWidth, `keyword found: ${keywords[i]} `)

          if (matchingElement[0] == null) {
            continue
          } else if (typeof matchingElement[0] == 'undefined') {
            continue
          }
          matchingElementList.push([matchingElement[0][0], matchingElement[0][1]])
          allMatchingElementList.push(matchingElement[0])

        }


        // return matchingElementList
        return [matchingElementList, allMatchingElementList]
      }, config.keywords)

      config.log.info("Elements coordinates that are found by searching specified keywords in clickFiveTimes function are:" + select_elements)
      config.log.info("ALL Elements coordinates that are found by searching specified keywords in clickFiveTimes function are:" + all_select_elements)
      config.log.info("Elements coordinates that are found by the script:" + elem_coords_tab)
      config.log.info("ALL Elements coordinates that are found by the script:" + all_elems_tab)


      // if((select_elements.length + elem_coords_tab.length) <= 6 || (select_elements.length <6) ){

      // select_elements.splice(-1, elem_coords_tab.length);

      // all_select_elements.splice(-1, all_elems_tab.length);

      for (const i in elem_coords_tab) {
        select_elements.push(elem_coords_tab[i])
      }

      for (const i in all_elems_tab) {
        all_select_elements.push(all_elems_tab[i])
      }

      // config.log.info("<=6")

      elem_coords_tab = select_elements
      all_elems_tab = all_select_elements
      // }
      // }else if((select_elements.length + elem_coords_tab.length) > 6){
      //   //  if(select_elements.length > 6 ){

      //         elem_coords_tab=select_elements
      //         all_elems_tab=all_select_elements
      //         config.log.info("select_elements.length > 6")
      //   //  }

      // }
      // if(select_elements.length!=0){
      //   config.log.info("Element coordinates found by the script in clickFiveTimes:"+elem_coords_tab)
      //   if(select_elements.length<3){

      //     elem_coords_tab.splice(-1, select_elements.length);

      //     all_elems_tab.splice(-1, all_select_elements.length);

      //     for(const i in select_elements){
      //       elem_coords_tab.push(select_elements[i])
      //     }

      //     for(const i in all_select_elements){
      //       all_elems_tab.push(all_select_elements[i])
      //     }

      //     config.log.info("Elements coordinates that are found by searching specified keywords in clickFiveTimes function are less than three")
      //   }else{

      //     elem_coords_tab=select_elements
      //     all_elems_tab=all_select_elements
      //     config.log.info("Elements coordinates that are found by searching specified keywords in clickFiveTimes function are more than three")
      //   }

      // }
      var c = ((elem_coords_tab.length > 5) ? 5 : elem_coords_tab.length);
      config.log.info("elem_coords_tab", elem_coords_tab)
      config.log.info("------------------------------------------------")
      config.log.info("all_select_elements", all_select_elements)
      config.log.info("clickFiveTimes starts from here")
      url_next = page_next.url()



      if (elem_coords_tab.length != 0) {
        console.log("before assigning object:" + JSON.stringify(json_object_before))

        try {
          var element_obj = await findElementByCoordinates(page_next, json_object_before.screenshot_name, all_elems_tab[0][0], all_elems_tab[0][1], all_elems_tab[0][2], all_elems_tab[0][3], all_elems_tab[0][4], all_elems_tab[0][5], all_elems_tab[0][6], all_elems_tab[0][7], all_elems_tab[0][8]) //The first json object does not have calculated elementobj
        } catch (e) {
          config.log.error("Error1 in findElementByCoordinates: " + e)


        }


        // json_object_before = Object.assign(json_object_before,element_obj);
        json_object_before.element_clicked = element_obj
        // json_object_before.element_clicked.screenshot_before_name=
        // json_object_before.element_clicked.screenshot_after_name=
        console.log("after assigning object:" + JSON.stringify(json_object_before))

        for (const i in elem_coords_tab) {

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


            var json_object = await resizeandTakeScreenshot(page_next, page_next.url(), tab_location, true, all_elems_tab[i])
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

          console.log("fire 1")

          var xCoord = elem_coords[i][0]
          var yCoord = elem_coords[i][1]

          console.log(1, xCoord, yCoord)

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

          // !=


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
              // var json_success4=await utils.json_log_append(config.json_file,null,json_object4,json_object.url,json_object.url_id)

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

              } catch (e) {
                config.log.error("error in clickFiveTimes for new tab closing tab:" + e)
              }
              await page_next.goto(url_next, { waitUntil: 'networkidle2' });
              // await waitTillHTMLRendered(page_next)
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

      // console.log("screenshot name is:"+screenshot_name)


      try {
        const cdp = await page_next.target().createCDPSession();
        const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
        fs.writeFileSync(mhtml_name + ".mhtml", data);
      } catch (e) {
        config.log.error("In capturesnapshot error:" + e)
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

        } catch (e) {
          config.log.error("Error during taking screenshot. Url is:" + url_i)
          config.log.error("error is:" + e)
          return { 'time': unix_time, 'screenshot_success': false, 'screenshot_name': null, 'url': url_i, 'url_id': url_id, 'element_clicked': null }

        }

        if (isClickableTab == true) {
          try {
            var element_obj = await findElementByCoordinates(page_next, ss_name, all_elems[0], all_elems[1], all_elems[2], all_elems[3], all_elems[4], all_elems[5], all_elems[6], all_elems[7], all_elems[8])
          } catch (e) {
            config.log.error("Error2 in findElementByCoordinates: " + e)

          }

        }
        if (config.USER_AGENTS[config.agent_name]["window_size_cmd"].length > 0) { // landscape resolution for the tablet
          var width_land = config.USER_AGENTS[config.agent_name]["window_size_cmd"][0]
          var height_land = config.USER_AGENTS[config.agent_name]["window_size_cmd"][1]
          var ss_name_land = screenshot_name + '_' + width_land + "x" + height_land + '.png'
          console.log('Test 2')
          try {
            await page_next.setViewport({ width: width_land, height: height_land })
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)
            await Promise.race([page_next.screenshot({ path: ss_name_land, type: 'png' }), new Promise((resolve, reject) => setTimeout(reject, 180000))]);

          } catch (e) {
            config.log.error("Error during taking screenshot. Url is:" + url_i)
            config.log.error("error is:" + e)

          }


        }
        if (!(await page_next.isClosed())) {
          try {
            await page_next.setViewport({ width: width, height: height })
            await page_next.waitForTimeout(config.WAIT_AFTER_RESIZE)
          } catch (e) {
            console.log.error("error in setting default resolution:" + e)

          }

        }
        config.log.info("screenshot_name in resize:" + ss_name)
        if (isClickableTab == true) {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': element_obj }
        } else {
          return { 'time': unix_time, 'screenshot_success': true, 'screenshot_name': ss_name, 'screenshot_size': default_ss_size, 'url_domain_id': url_hash, 'url': url_i, 'url_id': url_id, 'element_clicked': null }
        }


      } else {
        //  var time_ss=new Date().getTime()
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
          } catch (e) {
            config.log.error("Error during taking screenshot. Url is:" + url_i)
            config.log.error("error is:" + e)
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
              var element_obj = await findElementByCoordinates(page_next, ss_name, all_elems[0], all_elems[1], all_elems[2], all_elems[3], all_elems[4], all_elems[5], all_elems[6], all_elems[7], all_elems[8])
            } catch (e) {
              config.log.error("Error3 in findElementByCoordinates: " + e)

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

        //  let html = await page.content();
        if (html == null) {
          console.log("HERE IN WAITTILL")
          break
        }

        let currentHTMLSize = html.length;
        // let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length);
        // console.log('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize);
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

      //  added page timeout
      // const maxPageLifeTime = 1000*300 // close pages older than 300 seconds
      // const pageScanFrequency = 1000*60 // scan pages every 60 seconds

      // const setIntervalAsync = (fn, ms) => {
      //     fn().then(() => {
      //       setTimeout(() => setIntervalAsync(fn, ms), ms)
      //   })
      // }

      // const closeOldPages = async () => {
      //   if (browser) {
      //       for (const page of await browser.pages().slice(1)) {
      //           if ((!await page.isClosed() && (await browser.pages()).length > 1)) {
      //               const pageTimestamp = await page.evaluate(`window.performance.now()`)
      //               if (pageTimestamp > maxPageLifeTime) {
      //                 try{
      //                   await page.close()
      //                 }catch(err){
      //                   config.log.error("Error8:"+err)
      //                 }

      //               }
      //           }
      //       }
      //   }
      // }

      // setIntervalAsync(closeOldPages, pageScanFrequency)





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

      //  preservelogs



      browser.on('targetcreated', async target => {

        if (target.type() == 'page') {
          try {


            var page = await target.page()
            // console.log("URL URL URL URL"+page.url())
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
              // page._client.on('Network.requestIntercepted', ( (e) => {
              // console.log(`Intercepted request url:${request.url} {interception id: ${interceptionId}}`);
              // var requestt= '>> '+request.method+" "+request.url+'\n'
              // logger_rr.write(requestt)
              // console.log("IS download"+request.isDownload)
              // if(isDownload){
              var requestt = '>> ' + request.method + " " + request.url + ' Timestamp:' + new Date() + '\n'
              var reqHeaders = "Request headers:" + JSON.stringify(request.headers, null, 2) + "\n"
              var requesttt = requestt.concat('\n', reqHeaders)
              config.logger_rr.info(requesttt)
              // console.log(requestt)

              // }

              if (isDownload) {
                var resHeadersDownload = "Res headers for download:" + JSON.stringify(responseHeaders, null, 2) + "\n"
                console.log("IS download" + isDownload)
                config.log_download.info(requesttt)
                config.log_download.info(resHeadersDownload)
              }

              // console.log('Request headers are:'+JSON.stringify( request.headers, null, 2 ))
              // console.log('Response status code is:'+responseStatusCode)
              // console.log(e.request.url)
              page._client.send('Network.continueInterceptedRequest', {
                interceptionId,
              });
            }));


            page._client.on('Network.responseReceived', ((res) => {
              // new Date(res.timestamp)
              // res.response.timestamp
              var responseURLIP = '<< ' + res.response.status + " " + res.response.url + "  RemoteIP:" + res.response.remoteIPAddress + ' Timestamp:' + res.response.headers["date"] + '\n'
              var resHeaders = "Response headers:" + JSON.stringify(res.response.headers, null, 2) + "\n"
              var responses = responseURLIP.concat('\n', resHeaders)
              config.logger_rr.info(responses)
              // console.log(res.response.headers["Content-Disposition"])
              // console.log(responseURLIP)
              // console.log(res.response.mimeType)
              // console.log('GOT response headers: '+JSON.stringify( res.response.headers, null, 2 ))
              // logger_rr.write(responses)
            }));
            page.on('dialog', async dialog => {
              console.log('dialog');
              await dialog.accept();

            });
            await page.evaluate(() => {

              console.clear = () => { }

            })

            // page.on('request', (request) => {
            //   var requestt='>>'+request.method()+request.url()+'\n'
            //   config.logger_rr.write(requestt)
            //   // console.log(requestt)
            //   request.continue()
            //  })
            // await page.setRequestInterception(true)
            // //  Log all the requests made by the page

            //  // Log all the responses
            //  page.on('response',  (response) => {
            //   var responsee='<<' +response.status()+response.url()+"  RemoteIP:"+response.remoteAddress().ip+'\n'
            //   config.logger_rr.write(responsee)
            //   // console.log('<<', response.status(), response.url())
            //   // console.log(responsee)

            //  })

          }
          catch (e) {
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
      // count=0

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


        var [elems, imgs] = await page.evaluate(() => {
          function elementDimensions(element, wHeight, wWidth, reason) {
            var boundRect = element.getBoundingClientRect();
            var midy = boundRect.top + (boundRect.height / 2.0);
            var midx = boundRect.left + (boundRect.width / 2.0);
            if (boundRect.height != 0 && boundRect.width != 0 &&
              midy < wHeight && midx < wWidth && midy > 0 && midx > 0)
              return [midx, midy, boundRect.height, boundRect.width, boundRect.x, boundRect.y, boundRect.right, boundRect.bottom, reason];
            else
              return [];
          }
          // Args: an array of element objects, window height and window width
          // This function filters out elements that are
          // (1) of size 0
          // (2) Outside the viewport vertically or horizontally.
          // Returns a array of arrays
          function filterElementArrays(elements, wHeight, wWidth, reason) {
            var elem_sizes = [];
            for (var element of elements) {
              var elem = elementDimensions(element, wHeight, wWidth, reason);
              if (elem.length > 0)
                elem_sizes.push(elem);
            }
            return elem_sizes;
          }
          // Similar to filterElementArrays but takes xpathResult object as
          // one of the arguments
          function filterXpathResults(xpathResults, wHeight, wWidth, reason) {
            var elem_sizes = [];
            var element = xpathResults.iterateNext();
            while (element) {
              var elem = elementDimensions(element, wHeight, wWidth, reason);
              if (elem.length > 0)
                elem_sizes.push(elem);
              element = xpathResults.iterateNext();
            }
            return elem_sizes;
          }


          function getElementsByXpath(path) {
            var xpathres = document.evaluate(
              path, document, null,
              XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null);
            return xpathres;
          }


          // //Tries to retain return elements with unique sizes, and unique mid-points
          // //On some pages there are very close click-points that don't do anything different.
          // //Hence we try to filter out elements that have spatially close click points.

          function getElementData() {

            var wHeight = window.innerHeight;
            var wWidth = window.innerWidth;
            var element_data = [];
            var divs_xpath = getElementsByXpath('//div[not(descendant::div) and not(descendant::td)]');

            var divs = filterXpathResults(divs_xpath, wHeight, wWidth, "selected div (//div[not(descendant::div) and not(descendant::td)])");
            var tds_xpath = getElementsByXpath('//td[not(descendant::div) and not(descendant::td)]');
            var tds = filterXpathResults(tds_xpath, wHeight, wWidth, "selected td (//td[not(descendant::div) and not(descendant::td)])");
            var iframe_elems = document.getElementsByTagName('iframe');
            var iframes = filterElementArrays(iframe_elems, wHeight, wWidth, "selected iframe element");
            var a_elems = document.getElementsByTagName('a');
            var as = filterElementArrays(a_elems, wHeight, wWidth, "selected a element");
            element_data = element_data.concat(divs, tds);
            var img_elems = document.getElementsByTagName('img');
            var imgs = filterElementArrays(img_elems, wHeight, wWidth, "selected img element");
            var prefs = imgs.concat(as, iframes)
            return [element_data, prefs];
          }
          return getElementData()
        })

        var filtered_elements = await filter_elements(elems, imgs, width, height)
        var elem_coords = filtered_elements[0]
        var all_elems = filtered_elements[1]

        //  console.log("FILTERED ELEMENTS FIRST:",filtered_elements)
        //  console.log("elem_coords:"+elem_coords)
        //  console.log("--------------------------------------------")
        //  console.log("all_elems:"+all_elems)
        // var  elem_coords=await filter_elements(elems, imgs,width,height)
        // console.log("elem_coords:"+elem_coords)
        //  await page.waitForTimeout(1000000)


        // if(config.crawler_mode=="SE"){
        var [select_elements, all_select_elements] = await page.evaluate(function (keywords) {
          // var select_elements=await page.evaluate(function(keywords){
          var matchingElementList = []
          var allMatchingElementList = []
          // Similar to filterElementArrays but takes xpathResult object as
          function elementDimensions(element, wHeight, wWidth, reason) {
            var boundRect = element.getBoundingClientRect();
            var midy = boundRect.top + (boundRect.height / 2.0);
            var midx = boundRect.left + (boundRect.width / 2.0);
            if (boundRect.height != 0 && boundRect.width != 0 &&
              midy < wHeight && midx < wWidth && midy > 0 && midx > 0)
              // return [midx, midy, boundRect.height, boundRect.width];
              return [midx, midy, boundRect.height, boundRect.width, boundRect.x, boundRect.y, boundRect.right, boundRect.bottom, reason];
            else
              return [];
          }
          // one of the arguments
          function filterXpathResults(xpathResults, wHeight, wWidth, reason) {
            var elem_sizes = [];
            var element = xpathResults

            var elem = elementDimensions(element, wHeight, wWidth, reason);
            if (elem.length > 0)
              elem_sizes.push(elem);


            return elem_sizes;
          }

          var xpath = ""

          // var matchingElement =[]
          var wHeight = window.innerHeight;
          var wWidth = window.innerWidth;

          for (const i in keywords) {
            // matchingElement =[]
            // xpath = "//a[contains(text(),'Detecting Chrome Headless')]";
            // xpath = "//a[contains(text(),'"+keywords[i]+"')]";

            xpath = "//*[text()[contains(.,'" + keywords[i] + "')]]"
            // xpath = "//a[contains(text(),'Toy')]";
            var matchingElement = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (matchingElement == null) {

              continue
            } else if (matchingElement === undefined) {
              continue
            }


            matchingElement = filterXpathResults(matchingElement, wHeight, wWidth, `keyword found: ${keywords[i]} `)

            if (matchingElement[0] == null) {
              continue
            } else if (typeof matchingElement[0] == 'undefined') {
              continue
            }
            matchingElementList.push([matchingElement[0][0], matchingElement[0][1]])
            allMatchingElementList.push(matchingElement[0])

          }


          return [matchingElementList, allMatchingElementList]
          // return matchingElementList
        }, config.keywords)

        config.log.info("Elements coordinates that are found by searching specified keywords in landing page are:" + select_elements)
        // console.log("select_elements"+select_elements[0][0])
        // console.log("all_select_elements"+all_select_elements[0][0])
        // return
        if (select_elements.length != 0) {

          elem_coords.splice(-1, select_elements.length);
          all_elems.splice(-1, all_select_elements.length);


          for (const i in select_elements) {
            elem_coords.push(select_elements[i])
          }


          for (const i in all_select_elements) {
            all_elems.push(all_select_elements[i])
          }


        }

        // }
        var tabCount = (await browser.pages()).length
        // console.log("elem coords are:"+elem_coords)
        var tab_location = "FIRST"
        var json_object = await resizeandTakeScreenshot(page, url_first_tab, tab_location, true, all_elems[0])
        visited_URLs.add(url_first_tab)

        var url_json_success = utils.json_url_append(config.json_file_visited_urls, url_first_tab, url_first_tab)
        // console.log(json_success3)






        // await page.waitForTimeout(100000000)



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


        for (const i in elem_coords) {

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
          } catch (e) {

            config.log.error("Error1 in evaluating document.body.innerHTML. Url is")
            config.log.error("error is:" + e)
            html_before = null


          }

          // ###

          var html_changed = false

          var xCoord = elem_coords[i][0]
          var yCoord = elem_coords[i][1]

          console.log(2, xCoord, yCoord)

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




          // var tab_count1=(await browser.pages()).length
          // // if(tab_count1 != tabCount) // early stop rule
          // // {
          //   console.log("here2")
          //   console.log(tab_count1)
          //   var pages= await browser.pages()
          //   while (tab_count1=! 0 ){

          //     // var url_tab=await pages[(tab_count1-1)].url()
          //     // console.log(url_tab)

          //     console.log(tab_count1)

          //     // var different=utils.is_reg_dom_different(url_first_tab,url_tab)
          //     // console.log("the URL on the"+ tab_count1 +". tab is:"+url_tab)
          //     // if(different)
          //     // {
          //     //   config.log.info("early stop rule activated...")
          //     //   early_stop=true
          //     // }
          //     tab_count1=tab_count1-1

          //   }
          // console.log("here2")

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
                  // else{
                  //   console.log('TAB TIMEOUT IN THE FIRST TAB...revisiting')
                  //   clearInterval(trigger_tab);
                  // }

                }
                count1 = count1 + wait_interval
              }, wait_interval);


              if (page_next.isClosed()) {
                tabCountClicked = tabCountClicked - 1
                clearInterval(trigger_tab);
                continue
              }

              //burasi
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
              // var rank=20000
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
              // var tab_location='newTAB_'+(tabCountClicked-1)+'_coor_'+i
              var tab_location = 'new' + i

              var json_object4 = await resizeandTakeScreenshot(page_next, url_next, tab_location, false, "")
              // bunu sonra cikar


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

              //  var tab_location='newTAB_'+(tabCountClicked-1)+'_coor_'+i+'_'
              //  var tab_location='newTAB_coor_'+i+'_'
              console.log("before click 5 the tab count:" + tabCountClicked)

              //continue to click on in the ad opened in the new tab
              var ss_success_page_next = false
              try {
                console.log("TAB COUNT BEFORE VISITIN CLICKFIVETIMES:" + (await browser.pages()).length)
                var [early_stop, visited_URLs, totaltabcount_sess, ss_success_page_next] = await clickFiveTimes(url_first_tab, early_stop, tabCountClicked, url_next, browser, page_next, config.agent_name, visited_URLs, config.PAGE_LOAD_TIMEOUT_TABS, is_mobile, true, json_object.url, json_object.url_id, json_object4, totaltabcount_sess_before, totaltabcount_sess, visit_id_tab)
              } catch (e) {

                config.log.error("error in clickFiveTimes closing tab:" + e)
              }
              config.log.info(`ss_success_page_next is ${ss_success_page_next} in the url_next: ${url_next}`)

              if (ss_success_page_next == false) {
                var json_success4 = await utils.json_log_append(config.json_file, null, json_object4, json_object.url, json_object.url_id, config.tab_loc_newTAB, totaltabcount_sess_before, visit_id_tab)
                config.log.info(json_success4)

              }
              //  meeting
              //  var different=is_reg_dom_different(url_first_tab,url_next)
              // console.log("TAB COUNT AFTER VISITIN CLICKFIVETIMES:"+(await browser.pages()).length)
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
    catch (e) {
      config.log.error("an error happened during crawling:" + e)
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


  } catch (e) {
    config.log.error("Error during compressing netlog file:" + e)


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



  } catch (e) {
    config.log.error("Error during download page")
    if (!(await page_download.isClosed())) {
      await page_download.close()
    }

  }


  config.log.info('crawl process ended ::' + id)

  // config.logger_rr.end()
  // config.logger_chrm.end()
  // config.logger_coor.end()

  config.log.info("browser closed")
  var endTime = new Date();
  var [hours, minutes, seconds] = utils.calculateRunningTime(startTime, endTime)
  config.log.info(`Session lasted ${hours} hours ${minutes} minutes ${seconds} seconds`)
  await browser.close()
  process.exit();
  return
}


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












