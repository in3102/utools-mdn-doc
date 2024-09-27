const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hljs = require('highlight.js/lib/core')

const support = require('./support.js')
const utils = require('./utils.js')
const URL_HOST = 'https://developer.mozilla.org'
let urlWhite = 'docs/Web/'

hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'))
hljs.registerLanguage('css', require('highlight.js/lib/languages/css'))

function removeHtmlTag(content) {
	content = content.replace(/(?:<\/?[a-z][a-z1-6]{0,9}>|<[a-z][a-z1-6]{0,9} .+?>)/gi, '')
	return content
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
}

/**
 * @typedef {"CSS" | "HTML" | "HTTP" | "JavaScript" | "MathML" | "SVG" | "API" | "Media" | "Security" | "Manifest" | "Guide" | "Performance" | "WebDriver" | "XML" | "XPath" | "XSLT" | "Events" | "Tutorials" | "Text_fragments" | "Accessibility" | "Progressive_web_apps"} DocCategory 文档分类
 */
/**
 * 所有支持的文档类型
 */
const docCategories = ['CSS', 'HTML', 'HTTP', 'JavaScript', 'MathML', 'SVG', 'API', 'Media', 'Security', 'Manifest', 'Guide', 'Performance', 'WebDriver', 'XML', 'XPath', 'XSLT', 'Events', 'Tutorials', 'Text_fragments', 'Accessibility', 'Progressive_web_apps']

/**
 * @typedef UrlItem 网址项
 * @property {String} key 网址标题
 * @property {String} src 网址
 * @property { "en-US" | "zh-CN" } language 语言
 * @property {boolean}  verified 是否有效
 */

/**
 * 是否是文档网址
 * @param {string} url 网址
 * @return {boolean} 是否是文档网址
 */
function isWebDocUrl(url) {
	if (!url.includes(urlWhite)) {
		return false
	}
	if (!url.startsWith(URL_HOST) && !url.startsWith('/')) {
		return false
	}
	return true
}

/**
 * 添加网址到列表
 * @param {UrlItem[]} list 原网址列表
 * @param {UrlItem[]} urls 要添加的 网址数组 或 单一对象
 * @param {Number} insertIndex 插入位置
 * @return {*} 无返回值
 */
function addUrls(list, urls, insertIndex) {
	if (!Array.isArray(urls)) {
		urls = [urls]
	}
	for (let index = 0; index < urls.length; index++) {
		const urlItem = urls[index]
		if (!isWebDocUrl(urlItem.src)) {
			continue
		}
		if (!urlItem.language) {
			// urlItem.language = urlItem.src.includes('/zh-CN/') ? 'zh-CN' : 'en-US'
			//添加文档时优先选用中文,后续如果中文请求不到,自动改为英文
			urlItem.language = 'zh-CN'
			//替换掉网址中的语言部分
			urlItem.src = urlItem.src.replace('/zh-CN/', '/').replace('/en-US/', '/')
		}

		if (list.findIndex((y) => y.src === urlItem.src) >= 0) {
			continue
		}
		urlItem.verified = true
		list.splice(insertIndex, 0, urlItem)
	}
}

/**获取文档分类的索引
 * @param {DocCategory} docCategory 文档分类
 * @return {Promise<UrlItem[]>} 索引列表
 */
function getDocRefrence(docCategory) {
	if (!docCategories.includes(docCategory)) {
		throw new Error('不支持的文档分类: ' + docCategory)
	}
	urlWhite = 'docs/Web/' + docCategory + '/'
	utils.httpInit()
	let cachePath = path.join(process.cwd(), 'data', docCategory)
	if (!fs.existsSync(cachePath)) {
		fs.mkdirSync(cachePath)
	}
	let cacheName = path.join(process.cwd(), 'data', docCategory + '-refrences.json')
	if (fs.existsSync(cacheName)) {
		console.log(`---------- ${docCategory} 使用缓存---------`)
		return require(cacheName)
	}

	return new Promise(async (resolve, reject) => {
		console.log(`---------- ${docCategory} 开始获取---------`)
		/**网址目录
		 * @type {Array.<UrlItem>}
		 */
		let refrences = [
			{
				key: docCategory,
				src: '/docs/Web/' + docCategory,
				language: 'zh-CN',
				verified: true,
			},
		]
		for (let index = 0; index < refrences.length; index++) {
			utils.printCurrrLine(`[${index + 1}/${refrences.length}] ${refrences[index].src}`)
			let pageHtml
			try {
				pageHtml = await getPage(refrences[index], docCategory)
			} catch (e) {
				//某些文档页面确实不存在
				// If you look at the link on the page, you see that its page hasn't been written yet. This is already tracked in https://openwebdocs.github.io/web-docs-backlog/all/
				refrences[index].verified = false
				continue
			}
			const urls = getAllLinks(pageHtml)
			addUrls(refrences, urls, index + 1)
		}
		refrences = refrences.filter((x) => x.verified)
		fs.writeFileSync(cacheName, JSON.stringify(refrences, null, 2))
		utils.printClearLine()
		console.log(`---------- ${docCategory} 获取完成---------`)
		resolve(refrences)
	})
}

/**获取页面中的所有链接
 * @param {string} pageHtml 页面源代码
 * @return {Promise<UrlItem[]>} 所有网址信息
 */
function getAllLinks(pageHtml) {
	let refrences = []
	// 左侧大目录
	let match = pageHtml.match(/<div class="sidebar-body">([\s\S]*?)<\/div>/)
	if (match) {
		const regexList = /<li>[\s\S]*?<a[^>]*?href="([^"]*?)">(<code>)?([^>\n]*?)(<\/code>)?<\/a>/g
		while ((m = regexList.exec(match[1])) !== null) {
			if (m.index === regexList.lastIndex) {
				regexList.lastIndex++
			}
			let src = m[1]
			src = src.replace(URL_HOST, '')
			const key = removeHtmlTag(m[3].trim())
			refrences.push({ key, src })
		}
	}

	//获取 article 标签内的所有链接
	match = pageHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/)
	if (match) {
		const regexList = /<a [^>]*?href="([^#]*?)"[^>]*?>(<code>)?(.*?)(<\/code>)?<\/a>/g
		while ((m = regexList.exec(match[1])) !== null) {
			if (m.index === regexList.lastIndex) {
				regexList.lastIndex++
			}
			const src = m[1].trim()
			const key = removeHtmlTag(m[3].trim())
			refrences.push({ key, src })
		}
	}
	return refrences
}

/**
 * 转换HTML内容
 * @param {Array} lowerSrcArray 已转为小写的所有网址列表
 * @param {String} htmlContent 当前页面的HTML源代码
 * @return {String} 处理后的文档页面
 */
function convertHtmlContent(lowerSrcArray, htmlContent) {
	const lastModified = htmlContent.match(/last modified on<!-- --> <time dateTime="([^"]*?)T/)
	const match = htmlContent.match(/<article[^>]*>([\s\S]*?)<\/article>/)
	if (match) {
		htmlContent = match[1]
	}

	htmlContent = htmlContent.replace(/<aside class="metadata">.*?<\/aside>/, '')
	htmlContent = htmlContent.replace(/<ul class="prev-next">.*?<\/ul>/g, '')
	if (lastModified) {
		htmlContent += `<hr/><p class="last-modified-date"><b>最后更新于:</b> <time >${lastModified[1]}</time></p>`
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
			if (isWebDocUrl(url)) {
				//替换文档链接
				let shortUrl = url.replace(URL_HOST, '').toLowerCase().replace('/en-us/', '/').replace('/zh-cn/', '/')
				let anchor = ''
				if (shortUrl.includes('#')) {
					anchor = shortUrl.substring(shortUrl.indexOf('#'))
					shortUrl = shortUrl.substring(0, shortUrl.indexOf('#'))
				}

				if (lowerSrcArray.includes(shortUrl)) {
					const localFile = crypto.createHash('md5').update(shortUrl).digest('hex')
					let replaceText = 'href="' + url + '"'
					htmlContent = htmlContent.replace(new RegExp(replaceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'href="' + localFile + '.html' + anchor + '"')
					continue
				} else {
					// console.log('not found:', shortUrl)
				}
			}
			//外部链接无需处理
			if (/^https?:\/\//i.test(url)) continue
			const replaceRegex = new RegExp(('href="' + url + '"').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
			if (url.startsWith('/')) {
				htmlContent = htmlContent.replace(replaceRegex, 'href="' + URL_HOST + url + '"')
			}
		}
	}
	htmlContent = htmlContent.replace(/(<img[^>\n]+?src=")(\/[^"\n]+?")/g, '$1' + URL_HOST + '$2')
	// 代码美化
	let keys = { js: 'javascript', html: 'xml', css: 'css' }
	for (let key in keys) {
		const codes = htmlContent.match(new RegExp(`<pre[^>]*?class="brush: ?${key}[^"\n]*?"[^>]*?>[\\s\\S]+?<\\/pre>`, 'g'))
		if (codes) {
			codes.forEach((preRaw) => {
				const highlightedCode = hljs.highlight(removeHtmlTag(preRaw), { language: keys[key] }).value
				htmlContent = htmlContent.replace(preRaw, '<pre><code class="' + keys[key] + ' hljs">' + highlightedCode + '</code></pre>')
			})
		}
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

/**获取页面信息
 * @param {UrlItem} urlItem
 * @param {DocCategory} docCategory 文档分类
 * @return {Promise<string>} 页面内容
 */
async function getPage(urlItem, docCategory) {
	let url = `${urlItem.language}${urlItem.src}`
	const filename = crypto.createHash('md5').update(url.toLowerCase()).digest('hex')
	const cachePath = path.join(process.cwd(), 'data', docCategory, filename)
	url = URL_HOST + '/' + url
	try {
		return await utils.httpGet(url, cachePath)
	} catch (e) {
		if (!e.message.startsWith('notfound:')) {
			throw e
		}
		if (urlItem.language == 'en-US') {
			throw e
		}
		urlItem.language = 'en-US'
		// console.log('retry en-US------' + urlItem.src)
		return await getPage(urlItem, docCategory)
	}
}

/**获取文档摘要
 * @param {String} docHtml 文档Html内容
 * @return {String} 文档摘要,获取失败返回暂无描述
 */
function getDocSummary(docHtml) {
	const matchs = docHtml.match(/"summary":"(.*?)","/)
	return matchs ? matchs[1] : '暂无描述'
}

/**获取文档标题
 * @param {String} docHtml 文档Html内容
 * @param {String} defaultTitle 默认标题
 * @return {String} 成功返回识别的文档标题,否则返回默认标题
 */
function getDocTitle(docHtml, defaultTitle = '未知标题') {
	const matchs = docHtml.match(/<header><h1>(.*?)<\/h1>/)
	return matchs ? removeHtmlTag(matchs[1]) : defaultTitle
}

/**获取文章信息
 * @param {UrlItem} urlItem 当前网址信息
 * @param {string} docCategory 文档类型
 * @param {UrlItem} allUrl 全部网址信息
 * @return {utils.ArticleInfo} 文章信息
 */
async function getArticle(urlItem, docCategory, allUrl) {
	const [docFile, docHtml] = await getPage(urlItem, docCategory).then(async (html) => {
		let content = convertHtmlContent(allUrl, html)
		content = await support.changeBrowserSupport(html, content)
		const filename = crypto.createHash('md5').update(urlItem.src.toLowerCase()).digest('hex')
		fs.writeFileSync(path.join(process.cwd(), 'public', docCategory, 'docs', filename + '.html'), content)
		return ['docs/' + filename + '.html', html]
	})
	const summary = getDocSummary(docHtml)
	const docTitle = getDocTitle(docHtml, urlItem.key)
	return { t: docTitle, p: docFile, d: summary }
}

module.exports = {
	getDocRefrence,
	getArticle,
}
