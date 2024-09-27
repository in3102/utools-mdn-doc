const https = require('https')
const fs = require('fs')
const path = require('path')

function versionIsPreview(version, browser) {
	if (version === 'preview') {
		return true
	}

	if (browser && typeof version === 'string' && browser.releases[version]) {
		return ['beta', 'nightly', 'planned'].includes(browser.releases[version].status)
	}

	return false
}
function browserToIconName(browser) {
	const browserStart = browser.split('_')[0]
	return browserStart === 'firefox' ? 'simple-firefox' : browserStart
}
function getSupportClassName(support, browser) {
	if (!support) {
		return 'unknown'
	}

	let { flags, version_added, version_removed, partial_implementation } = support

	let className
	if (version_added === null) {
		className = 'unknown'
	} else if (versionIsPreview(version_added, browser)) {
		className = 'preview'
	} else if (version_added) {
		className = 'yes'
		if (version_removed || (flags && flags.length)) {
			className = 'no'
		}
	} else {
		className = 'no'
	}
	if (partial_implementation) {
		className = version_removed ? 'removed-partial' : 'partial'
	}

	return className
}
function parseSupper(browserSupport) {
	if(typeof browserSupport !== 'object'||typeof browserSupport.data !== 'object'){
		return ''
	}
	//获取所有支持的平台
	const supports = browserSupport.data.__compat ? browserSupport.data.__compat.support : browserSupport.data[Object.keys(browserSupport.data)[0]].__compat.support
	//获取所有平台类型
	const supportTypes = Object.keys(supports)
	//在 browsers 里面的平台 获取type
	let platformTypes = []
	let browsers = []
	supportTypes.forEach((item) => {
		browsers.push(browserSupport.browsers[item])
		const type = browserSupport.browsers[item].type
		if (type && platformTypes.indexOf(type) === -1) {
			platformTypes.push(type)
		}
	})
	let bc_platform_html = ''
	let bc_browser_html = ''
	platformTypes.forEach((item) => {
		const bc_browsers = browsers.filter((browser) => browser.type === item)
		bc_platform_html += `<th class="bc-platform bc-platform-${item}" colspan="${bc_browsers.length}" title="${item}"><span class="icon icon-${item}"></span><span class="visually-hidden">${item}</span></th>`
		for (const key in supports) {
			if (browserSupport.browsers[key].type === item) {
				bc_browser_html += `<th class="bc-browser bc-browser-${key}">
            <div class="bc-head-txt-label bc-head-icon-${key}">${key}</div>
            <div class="bc-head-icon-symbol icon icon-${browserToIconName(key)}"></div>
          </th>`
			}
		}
	})
	let bc_feature_html = ''
	for (const key in browserSupport.data) {
		let compat = browserSupport.data[key]
		if (compat.__compat) {
			compat = compat.__compat
		}
		let title
		if (compat.description) {
			title = compat.description
		} else if (key == '__compat') {
			title = ''
		} else {
			title = key
		}

		bc_feature_html += `<tr>
  <th class="bc-feature bc-feature-depth-0" scope="row">
    <div class="bc-table-row-header"><span>${title}</span></div>
  </th>`
		// console.log(key)
		// console.log('-------------------')
		platformTypes.forEach((item) => {
			for (const key2 in compat.support) {
				if (browserSupport.browsers[key2].type !== item) {
					continue
				}
				let label
				if (!compat.support[key2][0].version_added) {
					label = 'No'
				} else if (typeof compat.support[key2][0].version_added == 'string') {
					label = compat.support[key2][0].version_added
				} else {
					label = 'Yes'
				}
				bc_feature_html += `<td class="bc-support bc-browser-${key2} bc-supports-${compat.support[key2][0].version_added ? 'yes' : 'no'} bc-has-history" aria-expanded="false">
      <div class="bcd-cell-text-wrapper">
        <div class="bcd-cell-text-copy"><span class="bc-browser-name">${key2}</span><span class="bc-version-label" title="${compat.support[key2][0].release_date ? 'Released ' + compat.support[key2][0].release_date : ''}">${label}</span></div>
      </div>
  </td>`
			}
		})

		// console.log('\n\n\n')
	}

	let table = `
  <table class="bc-table bc-table-web">
	<thead>
		<tr class="bc-platforms"><td></td>${bc_platform_html}</tr>
		<tr class="bc-browsers"><td></td>${bc_browser_html}</tr>
	</thead>
	<tbody>${bc_feature_html}</tbody>
</table>`

	return table
}

const cacheDirBrowserSupport = path.join(__dirname, '../', 'data', 'browserSupport')
if (!fs.existsSync(cacheDirBrowserSupport)) {
	fs.mkdirSync(cacheDirBrowserSupport)
}
const regBrowserSupport = /<p>BCD tables only load in the browser<noscript> <!-- -->with JavaScript enabled. Enable JavaScript to view data.<\/noscript><\/p>/
const regBrowserSupportQuery = /"id":"(browser_compatibility|浏览器兼容性)".*?,"query":"(.*?)"/
/**
 * 更新浏览器兼容性
 * @param {String} html 获取到的页面源代码,用于检测是否有兼容性表格
 * @param {String} content 整理后的文档,用于替换兼容性表格
 * @return {String} 处理后的文档
 */
async function changeBrowserSupport(html, content) {
	//检查页面是否有兼容性表格
	if (!regBrowserSupport.test(html)) {
		return content
	}
	//正则获取是否有浏览器兼容性查询字段
	const browserSupportQuery = html.match(regBrowserSupportQuery)
	if (!browserSupportQuery) {
		return content
	}
	const query = browserSupportQuery[2]
	// console.log(query)
	//获取浏览器兼容性
	const cachePath = path.join(cacheDirBrowserSupport, query + '.json')
	let browserSupport
	if (fs.existsSync(cachePath)) {
		//读取缓存文件内容
		let json = fs.readFileSync(cachePath, { encoding: 'utf-8' })
		browserSupport = JSON.parse(json)
	} else {
		//https://bcd.developer.mozilla.org/bcd/api/v0/current/html.elements.input.type_hidden.json
		const url = 'https://bcd.developer.mozilla.org/bcd/api/v0/current/' + query + '.json'
		browserSupport = await new Promise((resolve, reject) => {
			https.get(url, (res) => {
				if(res.statusCode === 404){
					resolve({})
					return;
				}
				if (res.statusCode !== 200) {
					reject(new Error('获取浏览器兼容性失败:' +res.statusCode+" "+ url))
				}
				res.setEncoding('utf8')
				let rawData = ''
				res.on('data', (chunk) => {
					rawData += chunk
				})
				res.on('end', () => {
					try {
						//有些会返回错误信息
						//<?xml version='1.0' encoding='UTF-8'?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>
						let obj = JSON.parse(rawData)
						fs.writeFileSync(cachePath, rawData)
						resolve(obj)
					} catch (error) {
						resolve({})
					}
				})
			})
		}).catch((e) => {
			console.log(e.message)
			return content
		})
	}

	const table = parseSupper(browserSupport)
	return content.replace(regBrowserSupport, table)
}
module.exports = {
	parseSupper,
	changeBrowserSupport,
}
