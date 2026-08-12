// Thin re-export -- see models/index.js, the single place every model is
// defined and associated (avoids circular requires between model files).
module.exports = require("./index").User;
