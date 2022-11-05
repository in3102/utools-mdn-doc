const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hljs = require('highlight.js/lib/highlight.js')
hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'))
hljs.registerLanguage('css', require('highlight.js/lib/languages/css'))

function removeHtmlTag (content) {
  content = content.replace(/(?:<\/?[a-z][a-z1-6]{0,9}>|<[a-z][a-z1-6]{0,9} .+?>)/gi, '')
  return content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
}

function getLanguageRefrence (language) {
  return new Promise((resolve, reject) => {
    language=language.toUpperCase();
    const docUrlBase='https://developer.mozilla.org/zh-CN/docs/Web/' + language;
    https.get(docUrlBase, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error('😱  入口返回状态码 --- ', res.statusCode))
      }
      res.setEncoding('utf8')
      let rawData = ''
      res.on('data', (chunk) => { rawData += chunk })
      res.on('end', async () => {
        const matchs = rawData.match(/<ol>([\s\S]*?)<\/ol>\n<\/div>/g)
        const regexList = /<li>[\s\S]*?<a[^>]*?href="([^"]*?)">([^>\n]*?)<\/a><\/li>/g;
        if (!matchs) {
          return reject(new Error('😱  列表获取失败，未正确解析'))
        }
        let refrences = []
        try {
          matchs.forEach((x, i) => {
            let m;
            while ((m = regexList.exec(x)) !== null) {
                if (m.index === regexList.lastIndex) {regexList.lastIndex++;}
                const src = m[1].trim().replace('/en-US/', '/zh-CN/')
                const key = removeHtmlTag(m[2].trim())
                refrences.push({ key, src })
            }
          })
        } catch (e) {
          return reject(new Error('😱  ' + e.message))
        }
        let refrencesResult=[];
        refrencesResult.push(...refrences);
        if(language=='JAVASCRIPT')
        {
          //额外获取一下 标准内置对象 的二级目录
          console.log("🍺一级目录获取完毕,开始获取二级目录");
          for (let index = 0; index < refrences.length; index++) {
            if(refrences[index].src.includes('Global_Objects/'))
            {
                console.log('get------'+refrences[index].src)
                const urls=await getCatalogue(refrences[index].src,language)
                refrencesResult.push(...urls);
            }
          }
        }
        if (!fs.existsSync(path.join(__dirname, 'data'))) {
          fs.mkdirSync(path.join(__dirname, 'data'))
        }
        fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrencesResult, null, 2))
        resolve()
      })
    }).on('error', (e) => { reject(e) })
  })
}
//获取二级目录
function getCatalogue (url,language) {
  return new Promise(async (resolve, reject) => {
    let urlbase='https://developer.mozilla.org'+url;
    let res;
    try{
      res=await getPage(urlbase,language);
    }catch(e)
    {
      if (e.message.startsWith('notfound:')) {
        urlbase = e.message.replace('notfound:', '').replace('zh-CN/', 'en-US/')
        console.log('retry------'+urlbase)
        res=await getPage(urlbase,language);
      }
    }
    const regexList = /<li>[\s\S]*?<a[^>]*?href="([^"]*?)"><code>([^>\n]*?)<\/code>/g;
      let refrences = []
      try {
          while ((m = regexList.exec(res)) !== null) {
              if (m.index === regexList.lastIndex) {regexList.lastIndex++;}
              const src = m[1].trim().replace('/en-US/', '/zh-CN/')
              if(!src.includes(url))
              {
                break;
              }
              const key = removeHtmlTag(m[2].trim())
              refrences.push({ key, src })
          }
      } catch (e) {
        return reject(new Error('😱  获取二级目录出错:' + e.message))
      }
      resolve(refrences)
  })
}

// 获取描述摘要
function getDocSummary (src, language) {
  const filename = crypto.createHash('md5').update(src.toLowerCase()).digest('hex')
  const cachePath = path.join(__dirname, 'data', language, filename)
  if (fs.existsSync(cachePath)) {
    return new Promise((resolve, reject) => {
      fs.readFile(cachePath, { encoding: 'utf-8' }, (err, data) => {
        if (err) {
          return reject(err)
        }
        const matchs = data.match(/"summary":"(.*?)","/)
        resolve(matchs?matchs[1]:"暂无描述")
      })
    })
  } 
  return reject('error:文档文件不存在')
}

function convertHtmlContent (lowerSrcArray, htmlContent) {
  const match=htmlContent.match(/<article[^>]*>([\s\S]*?)<\/article><\/main>/);
  if(match){htmlContent=match[1]}
  
  const lastModified=htmlContent.match(/<b>Last modified:<\/b> <time[^>]*>(.*)<\/time>/);
  htmlContent = htmlContent.replace(/<aside class="metadata">.*?<\/aside>/, '')
  htmlContent = htmlContent.replace(/<ul class="prev-next">.*?<\/ul>/g, '')
  if(lastModified)
  {
    htmlContent+=`<hr/><p class="last-modified-date"><b>最后更新于:</b> <time >${lastModified[1]}</time></p>`
  }
  if (htmlContent.includes('class="prevnext"')) {
    htmlContent = htmlContent.replace(/<div class="prevnext"[\s\S]+?<\/div>/g, '')
  }
  if (htmlContent.includes('class="prev-next"')) {
    htmlContent = htmlContent.replace(/<ul class="prev-next"[\s\S]+?<\/ul>/g, '')
  }
  
  htmlContent = htmlContent.replace(/<section class="Quick_links" id="Quick_Links">[\s\S]+?<\/section>/, '')

  if (htmlContent.includes('<iframe ')) {
    htmlContent = htmlContent.replace(/<iframe.+src="([^"\n]+?)"[^>\n]*?>.*?<\/iframe>/g, '<a class="interactive-examples-link" href="$1">查看示例</a>')
  }
  const links = htmlContent.match(/<a[^>\n]+?href="[^"\n]+?"/g)
  if (links) {
    // 链接集合
    const linkSet = new Set(links)
    for (let link of linkSet) {
      let url = link.match(/<a[^>\n]+?href="([^"\n]+?)"/)[1].trim()
      if (url.startsWith('https://developer.mozilla.org')) {
        let shortUrl = url.replace('https://developer.mozilla.org', '')
        let anchor = ''
        if (shortUrl.includes('#')) {
          anchor = shortUrl.substring(shortUrl.indexOf('#'))
          shortUrl = shortUrl.substring(0, shortUrl.indexOf('#'))
        }
        if (shortUrl.startsWith('/en-US/')) {
          shortUrl = shortUrl.replace('/en-US/', '/zh-CN/')
        }
        if (lowerSrcArray.includes(shortUrl.toLowerCase())) {
          const localFile = crypto.createHash('md5').update(shortUrl.toLowerCase()).digest('hex')
          let replaceText = 'href="' + url + '"'
          htmlContent = htmlContent.replace(new RegExp(replaceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'href="' + localFile + '.html' + anchor + '"')
        }
        continue
      }
      if (/^https?:\/\//i.test(url)) continue
      const replaceRegex = new RegExp(('href="' + url + '"').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      let anchor = ''
      if (url.includes('#')) {
        anchor = url.substring(url.indexOf('#'))
        url = url.substring(0, url.indexOf('#'))
      }
      if (url.startsWith('/en-US/')) {
        url = url.replace('/en-US/', '/zh-CN/')
      }
      if (lowerSrcArray.includes(url.toLowerCase())) {
        const localFile = crypto.createHash('md5').update(url.toLowerCase()).digest('hex')
        htmlContent = htmlContent.replace(replaceRegex, 'href="' + localFile + '.html' + anchor + '"')
      } else if (url.startsWith('/')) {
        htmlContent = htmlContent.replace(replaceRegex, 'href="https://developer.mozilla.org' + url + anchor + '"')
      } else {
        //htmlContent = htmlContent.replace(replaceRegex, 'href="javascript:void(0)"')
        htmlContent = htmlContent.replace(replaceRegex, 'href="'+anchor+'"')
      }
    }
  }
  htmlContent = htmlContent.replace(/(<img[^>\n]+?src=")(\/[^"\n]+?")/g, '$1https://developer.mozilla.org$2')
  // JS 代码美化
  const jsCodes = htmlContent.match(/<pre.*?class="brush: ?js[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (jsCodes) {
    jsCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight('javascript', removeHtmlTag(preRaw)).value
      htmlContent = htmlContent.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
    })
  }
  // HTML 代码美化
  const htmlCodes = htmlContent.match(/<pre.*?class="brush: ?html[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (htmlCodes) {
    htmlCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight('xml', removeHtmlTag(preRaw)).value
      htmlContent = htmlContent.replace(preRaw, '<pre><code class="xml hljs">' + highlightedCode + '</code></pre>')
    })
  }
  // CSS 代码美化
  const cssCodes = htmlContent.match(/<pre.*?class="brush: ?css[^"\n]*?">[\s\S]+?<\/pre>/g)
  if (cssCodes) {
    cssCodes.forEach(preRaw => {
      const highlightedCode = hljs.highlight('css', removeHtmlTag(preRaw)).value
      htmlContent = htmlContent.replace(preRaw, '<pre><code class="css hljs">' + highlightedCode + '</code></pre>')
    })
  }
  return `<!DOCTYPE html><html lang="zh_CN"><head><meta charset="UTF-8"><title></title><link rel="stylesheet" href="doc.css" /></head>
  <body>${htmlContent}</body></html>`
  // const jsSyntaxCodes = rawData.match(/<pre.*?class="syntaxbox">[\s\S]+?<\/pre>/g)
  // if (jsSyntaxCodes) {
  //   jsSyntaxCodes.forEach(preRaw => {
  //     const highlightedCode = hljs.highlight('javascript', removeHtmlTag(preRaw)).value
  //     rawData = rawData.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
  //   })
  // }
}

function getPage(url,language)
{
  const filename = crypto.createHash('md5').update(url.toLowerCase()).digest('hex')
  const cachePath = path.join(__dirname, 'data', language, filename)
  if (fs.existsSync(cachePath)) {
    return new Promise((resolve, reject) => {
      fs.readFile(cachePath, { encoding: 'utf-8' }, (err, data) => {
        if (err) {
          return reject(err)
        }
        resolve(data)
      })
    })
  } else {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return reject(new Error('redirect:' + res.headers['location']))
          }
          if (res.statusCode === 404) {
            return reject(new Error('notfound:' + url))
          }
          return reject(new Error('🥵  获取页面 返回状态码 *** ' + res.statusCode + '\n' + src))
        }
        res.setEncoding('utf8')
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
          // 保存一份缓存
          const cacheDir = path.join(__dirname, 'data', language)
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir)
          }
          fs.writeFileSync(cachePath, rawData)
          resolve(rawData)
        })
      })
    })
  }
}

// 获取页面
function getDocPage (lowerSrcArray, src, language) {
  const filename = crypto.createHash('md5').update(src.toLowerCase()).digest('hex')
  const cachePath = path.join(__dirname, 'data', language, filename)
  if (fs.existsSync(cachePath)) {
    return new Promise((resolve, reject) => {
      fs.readFile(cachePath, { encoding: 'utf-8' }, (err, data) => {
        if (err) {
          return reject(err)
        }
        fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), convertHtmlContent(lowerSrcArray, data))
        resolve('docs/' + filename + '.html')
      })
    })
  } else {
    return new Promise((resolve, reject) => {
      https.get('https://developer.mozilla.org' + src + '?raw&macros', (res) => {
        if (res.statusCode !== 200) {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return reject(new Error('redirect:' + res.headers['location']))
          }
          if (res.statusCode === 404) {
            return reject(new Error('notfound:' + src))
          }
          return reject(new Error('🥵  获取页面 返回状态码 *** ' + res.statusCode + '\n' + src))
        }
        res.setEncoding('utf8')
        let rawData = ''
        res.on('data', (chunk) => { rawData += chunk })
        res.on('end', () => {
          // 保存一份缓存
          const cacheDir = path.join(__dirname, 'data', language)
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir)
          }
          fs.writeFileSync(path.join(cacheDir, filename), rawData)
          fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), convertHtmlContent(lowerSrcArray, rawData))
          resolve('docs/' + filename + '.html')
        })
      })
    })
  }
}

async function main () {
  const argv = process.argv.slice(2)
  const language = argv[0]
  if (!fs.existsSync(path.join(__dirname, 'data', language + '-refrences.json'))) {
    try {
      await getLanguageRefrence(language)
    } catch (e) {
      console.log(e.message)
      return
    }
    console.log(language + '----------索引获取完成---------')
  }
  const refrences = require('./data/' + language + '-refrences.json')
  const indexPath=path.join(__dirname, 'public', language, 'docs');
  if(!fs.existsSync(indexPath))
  {
    fs.mkdirSync(indexPath);
  }
  const lowerSrcArray = refrences.map(x => x.src.toLowerCase())
  const failItems = []
  const indexesFilePath = path.join(__dirname, 'public', language, 'indexes.json')
  let indexes = []
  let oldIndexes = null
  if (fs.existsSync(indexesFilePath)) {
    oldIndexes = require('./public/' + language + '/indexes.json')
  }
  for (let i = 0; i < refrences.length; i++) {
    const item = refrences[i]
    let t = item.key
    let p
    let d
    try {
      p = await getDocPage(lowerSrcArray, item.src, language)
      
      if (oldIndexes) {
        const oldItem = oldIndexes.find(x => x.t === t)
        if (oldItem) {
          d = oldItem.d
        } else {
          d = await getDocSummary(item.src,language)
        }
      } else {
        d = await getDocSummary(item.src,language)
      }
    } catch (e) {
      if (e.message.startsWith('redirect:')) {
        item.src = e.message.replace('redirect:', '').replace('?raw=&macros=', '')
      }
      if (e.message.startsWith('notfound:')) {
        item.src = e.message.replace('notfound:', '').replace('zh-CN/', 'en-US/')
      }
      failItems.push(item)
      console.log('fail-------', e.message)
      continue
    }
    indexes.push({ t, p, d })
    console.log(`[${i+1}/${refrences.length}]ok-------`, item.src)
  }
  for (let i = 0; i < failItems.length; i++) {
    const item = failItems[i]
    try {
      
      const p = await getDocPage(lowerSrcArray, item.src, language)
      const d = await getDocSummary(item.src,language)
      indexes.push({ t: item.key, p, d })
    } catch (e) {
      console.log('重试获取失败---------', e.message)
    }
  }
  fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
  fs.writeFileSync(indexesFilePath, JSON.stringify(indexes))
  fs.copyFileSync(path.join(__dirname, 'doc.css'), path.join(__dirname, 'public', language, 'docs', 'doc.css'))
  console.log('--------  😁 😁 😁 😁 😁 😁 😁 😁 😁 😁 --------')
}

main()
