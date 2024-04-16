export default {
    // fetch方法是这个模块的主要方法，它处理了请求并返回了响应
    async fetch(req, env, ctx) {
        // 如果请求方法是OPTIONS，返回一个空的响应
        if (req.method === "OPTIONS") {
            return new Response("", {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    "Access-Control-Allow-Headers": '*'
                }, status: 204
            })
        }

        // 尝试从请求中获取JSON数据，如果失败则使用默认值
        var body = {}
        try {
            body = await req.json()
        } catch (e) {
            body = {
                "messages": [{"role": "user", "content": (new URL(req.url)).searchParams.get('q') || "hello"}],
                "model": "command-r",
                "temperature": 0.5,
                "presence_penalty": 0,
                "frequency_penalty": 0,
                "top_p": 1,
                stream: true
            }
        }

        // 初始化数据对象，用于存储聊天历史和消息
        var data = {chat_history: []}
        try {
            for (let i = 0; i < body.messages.length - 1; i++) {
                data.chat_history.push({
                    "role": body.messages[i].role === "assistant" ? "CHATBOT" : body.messages[i].role.toUpperCase(),
                    "message": body.messages[i].content
                })
            }
            data.message = body.messages[body.messages.length - 1].content
        } catch (e) {
            return new Response(e.message);
        }
        data.stream = body.stream === true

        // 如果模型名称以"net-"开头，添加web-search连接器
        if ((body.model + "").indexOf("net-") === 0) data.connectors = [{"id": "web-search"}];
        for (let i in body) {
            if (!/^(model|messages|stream)/i.test(i)) data[i] = body[i];
        }
        if (/^(net-)?command/.test(body.model)) data.model = body.model.replace(/^net-/, "");
        if (!data.model) data.model = "command-r";

        // 发送POST请求到Cohere API
        var resp = await fetch('https://api.cohere.ai/v1/chat', {
            method: "POST",
            body: JSON.stringify(data),
            headers: {
                'content-type': 'application/json',
                "Authorization": req.headers.get('authorization') || "bearer " + (new URL(req.url)).searchParams.get('key')
            }
        })
        if (resp.status !== 200) return resp;

        var created = parseInt(Date.now() / 1000);

        // 如果不是流式传输，尝试获取JSON响应并返回
        if (!data.stream) {
            try {
                var ddd = await resp.json()
            } catch (e) {
                ddd = {error: e.message}
            }
            return new Response(JSON.stringify({
                "id": "chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK",
                "object": "chat.completion",
                "created": created,
                "model": data.model,
                "choices": [{
                    "index": 0, "message": {
                        "role": "assistant",
                        "content": ddd.text || ddd.error
                    }, "logprobs": null, "finish_reason": "stop"
                }], "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, "system_fingerprint": null
            }), {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    "Access-Control-Allow-Headers": '*',
                    'Content-Type': 'application/json; charset=UTF-8'
                }, status: resp.status
            })
        }

        // 如果是流式传输，创建一个TransformStream并处理响应
        const {readable, writable} = new TransformStream();
        const my_stream_writer = writable.getWriter();

        // 处理响应的主要逻辑
        ;(async () => {
            var reader = resp.body.getReader();
            var totalText = "";
            const decoder = new TextDecoder('utf-8', {stream: true});

            ;(async () => {
                var encoder = new TextEncoder();
                var isEnd = false;

                while (!isEnd) {
                    await sleep(20);
                    var msgs = totalText.split('\n');
                    var index = 0;
                    for (; index < msgs.length; index++) {
                        try {
                            let msg = JSON.parse(msgs[index])
                            if (msg.text) {
                                var txt = JSON.stringify({
                                    "id": "chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK",
                                    "object": "chat.completion.chunk",
                                    "created": created,
                                    "model": data.model,
                                    "choices": [{
                                        "index": 0,
                                        "delta": {"role": "assistant", "content": msg.text},
                                        "finish_reason": null
                                    }]
                                })
                                my_stream_writer.write(encoder.encode('data: ' + txt + '\n\n'));
                            }
                            if (msg.is_finished) {
                                await my_stream_writer.write(encoder.encode(`data: {"id":"chatcmpl-QXlha2FBbmROaXhpZUFyZUF3ZXNvbWUK","object":"chat.completion.chunk","created":${created},"model":"${data.model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`));
                                await my_stream_writer.close();
                                isEnd = true;
                            }
                        } catch (e) {
                            break;
                        }
                    }
                    if (index < msgs.length) {
                        totalText = msgs[msgs.length - 1]
                    } else {
                        totalText = ""
                    }
                }
            })()

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                totalText += decoder.decode(value, {stream: true})
            }
        })()

        // 返回一个新的响应，包含readable流
        return new Response(readable, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                "Access-Control-Allow-Headers": '*',
                'Content-Type': 'text/event-stream; charset=UTF-8'
            }, status: resp.status
        })

    },
};

// onRequest方法是一个导出函数，它调用了fetch方法处理请求
export function onRequest(context) {
    return exports.fetch(context.request)
}

// sleep函数是一个辅助函数，用于暂停执行一段时间
function sleep(ms) {
    return new Promise((r) => {
        setTimeout(r, ms);
    })
}
