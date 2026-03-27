(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('RBQ Core API 缺失!');
    console.info("🌸 Hello from RBQ-Draw HelloWorld Sub-Plugin! 🌸");
    RBQ.on('buildGeneratePayload', (payload) => {
        toastr.info("Hello World 子插件：我看到了你的绘画请求，已打印到控制台！");
        console.log("【子插件监控】拦截到的请求参数为: ", payload);
        return payload; 
    });
})(RBQ, jQuery, toastr);
