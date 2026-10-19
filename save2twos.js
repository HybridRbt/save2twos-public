// See online documentation for examples
// https://docs.getdrafts.com/docs/actions/scripting

async function main() {
  const cred = getCredential();

  if (cred === null) {
    app.displayErrorMessage('没有配置 API 信息');
    context.cancel();
    return;
  }

  if (!draft.content) {
    app.displayErrorMessage('内容为空');
    context.cancel();
    return;
  }

  //const tags = draft.tags ? draft.tags : [];

  //tags.push('Drafts');

  let content = draft.content;

/*  if (tags.length) {
    content += '  ' + tags.map((tag) => `#${tag}`).join(' ');
  }
*/
  putMemo(cred, content);
}

function putMemo(cred, content) {
  const http = HTTP.create();
var data = {
      "text": content,
	  "user_id": cred.user_id,
      "token": cred.token
    }
  const response = http.request({
    "url": cred.api,
    "method": "POST",
    "data": data,
"headers": {
	    "Accept": "application/json"
		}
  });

//console.log("HTTP Status: " + response.statusCode);
//	console.log("HTTP Response: " + response.responseText);
  if (response.statusCode != 200) {
    const err = new Error(response.error);
    err.response = JSON.stringify(response);
  
throw err;
  }
}

function getCredential() {
  const credential = Credential.create('Post to Twos', 'Add API info');
  credential.addTextField('api', 'API URL');
  credential.addTextField('user_id', 'User ID');
  credential.addTextField('token', 'Token');
  credential.authorize();

  return {
    api: credential.getValue('api'),    
	user_id: credential.getValue('user_id'),
    token: credential.getValue('token')
  };
}

main()
  .then(() => script.complete())
  .catch((err) => {
    console.log(err);
    context.fail(err.message);
    script.complete();
  });
