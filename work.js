const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hljs = require('highlight.js/lib/highlight.js')
const support = require('./lib/support.js')
hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'))
hljs.registerLanguage('css', require('highlight.js/lib/languages/css'))
const URL_BASE='https://developer.mozilla.org/zh-CN/docs/Web/';

function removeHtmlTag (content) {
  content = content.replace(/(?:<\/?[a-z][a-z1-6]{0,9}>|<[a-z][a-z1-6]{0,9} .+?>)/gi, '')
  return content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
}

function getLanguageRefrence (language) {
  return new Promise((resolve, reject) => {
    language=language.toUpperCase();
    const docUrlBase=URL_BASE + language;
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
            //<code>&lt;a&gt;</code>
            x=x.replace(/<code>(.*?)<\/code>/g,'$1')
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
        //将入口页面也增加下采集
        refrencesResult.unshift({
          "key": language,
          "src": '/zh-CN/docs/Web/'+language
        });
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
/**
 * 转换HTML内容
 * @param {Array} lowerSrcArray 已转为小写的所有网址列表
 * @param {String} htmlContent 当前页面的HTML源代码
 * @return {String} 处理后的文档页面
 */
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

/**
 * 获取文档页面
 * @param {Array} lowerSrcArray 已转为小写的所有网址列表
 * @param {String} src 当前页面网址
 * @param {String} language 当前语言
 * @return {String} 处理后的文档路径
 */
function getDocPage (lowerSrcArray, src, language) {
  const filename = crypto.createHash('md5').update(src.toLowerCase()).digest('hex')
  const cachePath = path.join(__dirname, 'data', language, filename)
  if (fs.existsSync(cachePath)) {
    return new Promise((resolve, reject) => {
      fs.readFile(cachePath, { encoding: 'utf-8' }, async (err, data) => {
        if (err) {
          return reject(err)
        }
        const html = data.toString()
        let content = convertHtmlContent(lowerSrcArray, html)
        content = await support.changeBrowserSupport(html,content)
        fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), content)
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
        res.on('end', async () => {
          // 保存一份缓存
          const cacheDir = path.join(__dirname, 'data', language)
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir)
          }
          fs.writeFileSync(path.join(cacheDir, filename), rawData)
          const html = rawData.toString()
          let content = convertHtmlContent(lowerSrcArray, html)
          content = await support.changeBrowserSupport(html,content)
          fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), content)
          resolve('docs/' + filename + '.html')
        })
      })
    })
  }
}

function copyFolder(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target)
  }

  // 读取源文件夹中的所有文件/文件夹
  const files = fs.readdirSync(source);

  // 遍历所有文件/文件夹
  files.forEach(file => {
    const sourcePath = path.join(source, file);
    const targetPath = path.join(target, file);

    // 判断当前文件是否为文件夹
    if (fs.statSync(sourcePath).isDirectory()) {
      // 如果是文件夹，递归拷贝子文件夹
      copyFolder(sourcePath, targetPath);
    } else {
      // 如果是文件，直接拷贝
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}
/**
 * 更新文档中的 更新时间 和 文档数量
 * @param {String} language 语言
 * @param {Array} indexes 文档目录
 */
function updateReadMe(language,indexes)
{
  // 最后更新: 2023-10-14 // 文档数量: 197 篇
  const readmePath=path.join(__dirname, 'public', language, 'README.md');
  fs.readFile(readmePath, { encoding: 'utf-8' }, async (err, data) => {
    if (err) {
      return
    }
    const doc = data.toString()
    const reg = /最后更新: \d{4}-\d{2}-\d{2}/
    const reg2 = /文档数量: \d+ 篇/
    const date = new Date()
    const dateStr = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()
    let newDoc = doc.replace(reg, '最后更新: ' + dateStr).replace(reg2, '文档数量: ' + indexes.length + ' 篇')
    const regCatalogue = /(文档目录:\s+)[\s\S]+/
    let catalogue = indexes.map(item=>'- '+item.t).join("\r\n")
    newDoc = newDoc.replace(regCatalogue,"$1")+catalogue
    fs.writeFileSync(readmePath, newDoc)
  })

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
  //所有网址转小写,对比使用
  const lowerSrcArray = refrences.map(x => x.src.toLowerCase())
  const failItems = []
  const indexesFilePath = path.join(__dirname, 'public', language, 'indexes.json')
  let indexes = []
  let oldIndexes = null
  if (fs.existsSync(indexesFilePath)) {
    oldIndexes = require('./public/' + language + '/indexes.json')
  }
  const lenStrLen=String(refrences.length).length;
  for (let i = 0; i < refrences.length; i++) {
    const logStart=`[${String(i+1).padStart(lenStrLen,'0')}/${refrences.length}]`
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
      console.log(logStart,'💢', e.message)
      continue
    }
    indexes.push({ t, p, d })
    console.log(logStart,'✅', item.src)
  }
  if(failItems.length>0)
  {
    console.log('再尝试获取下刚才失败的'+failItems.length+'个网址,检查下是否有英文版');
  }
  const lenStrLen2=String(failItems.length).length;
  for (let i = 0; i < failItems.length; i++) {
    const logStart=`[${String(i+1).padStart(lenStrLen2,'0')}/${failItems.length}]`
    const item = failItems[i]
    if(item.src.indexOf(":")!=-1)
    {
      console.log('不是官网的网址,跳过',item.src);
      continue;
    }
    try {
      const p = await getDocPage(lowerSrcArray, item.src, language)
      const d = await getDocSummary(item.src,language)
      indexes.push({ t: item.key, p, d })
      console.log(logStart,'✅', item.src)
    } catch (e) {
      console.log(logStart,'💢', e.message)
    }
  }
  fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
  fs.writeFileSync(indexesFilePath, JSON.stringify(indexes))
  fs.copyFileSync(path.join(__dirname, 'doc.css'), path.join(__dirname, 'public', language, 'docs', 'doc.css'))
  copyFolder(path.join(__dirname, 'images'), path.join(__dirname, 'public', language, 'docs', 'images'))
  updateReadMe(language,indexes)
  console.log('--------  😁 全部完成,共计'+indexes.length+'篇文档 --------')
}

main()
