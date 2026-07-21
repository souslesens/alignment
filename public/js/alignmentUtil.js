 var AlignmentUtil = (function () {
    var self = {}












    self.execSparql = function (source, query, callback) {
        var url = Config.sparql_server.url + "?format=json&query=";

        Sparql_proxy.querySPARQL_GET_proxy(url, query, "", {source: source}, function (err, result) {
            return callback(err, result)

        })
    }


    return self;
})()

export default AlignmentUtil;
window.AlignmentUtil = AlignmentUtil