var _ = require('lodash')

/**
 * Order should be a String (with the property name assumed ascending)
 * or an Array or property String names.
 *
 * Examples:
 *
 * 1. 'property1' (ORDER BY property1 ASC)
 * 2. '-property1' (ORDER BY property1 DESC)
 * 3. [ 'property1' ] (ORDER BY property1 ASC)
 * 4. [ '-property1' ] (ORDER BY property1 DESC)
 * 5. [ 'property1', 'A' ] (ORDER BY property1 ASC)
 * 6. [ 'property1', 'Z' ] (ORDER BY property1 DESC)
 * 7. [ '-property1', 'A' ] (ORDER BY property1 ASC)
 * 8. [ 'property1', 'property2' ] (ORDER BY property1 ASC, property2 ASC)
 * 9. [ 'property1', '-property2' ] (ORDER BY property1 ASC, property2 DESC)
 * ...
 */
exports.standardizeOrder = function (order) {
	if (typeof order === "string") {
		if (order[0] === "-") {
			return [ [ order.substr(1), "Z" ] ];
		}
		return [ [ order, "A" ] ];
	}

	var new_order = [], minus;

	for (var i = 0; i < order.length; i++) {
		minus = (order[i][0] === "-");

		if (i < order.length - 1 && [ "A", "Z" ].indexOf(order[i + 1].toUpperCase()) >= 0) {
			new_order.push([
				(minus ? order[i].substr(1) : order[i]),
				order[i + 1]
			]);
			i += 1;
		} else if (minus) {
			new_order.push([ order[i].substr(1), "Z" ]);
		} else {
			new_order.push([ order[i], "A" ]);
		}
	}

	return new_order;
};

/**
 * Operations
 * A) Build an index of associations, with their name as the key
 * B) Check for any conditions with a key in the association index
 * C) Ensure that our condition supports array values
 * D) Remove original condition (not DB compatible)
 * E) Convert our association fields into an array, indexes are the same as model.id
 * F) Itterate through values for the condition, only accept instances of the same type as the association
 */
exports.checkConditions = function (conditions, one_associations) {
	var k, i, j;

	// A)
	var associations = {};
	for (i = 0; i < one_associations.length; i++) {
		associations[one_associations[i].name] = one_associations[i];
	}

	for (k in conditions) {
		// B)
		if (!associations.hasOwnProperty(k)) continue;

		// C)
		var values = conditions[k];
		if (!Array.isArray(values)) values = [values];

		// D)
		delete conditions[k];

		// E)
		var association_fields = Object.keys(associations[k].field);
		var model = associations[k].model;

		// F)
		for (i = 0; i < values.length; i++) {
			if (values[i].isInstance && values[i].model().uid === model.uid) {
				if (association_fields.length === 1) {
					if (typeof conditions[association_fields[0]] === 'undefined') {
						conditions[association_fields[0]] = values[i][model.id[0]];
					} else if(Array.isArray(conditions[association_fields[0]])) {
						conditions[association_fields[0]].push(values[i][model.id[0]]);
					} else {
						conditions[association_fields[0]] = [conditions[association_fields[0]], values[i][model.id[0]]];
					}
				} else {
					var _conds = {};
					for (j = 0; j < association_fields.length; i++) {
						_conds[association_fields[j]] = values[i][model.id[j]];
					}

					conditions.or = conditions.or || [];
					conditions.or.push(_conds);
				}
			}
		}
	}

	return conditions;
};

/**
 * Gets all the values within an object or array, optionally
 * using a keys array to get only specific values
 */
exports.values = function (obj, keys) {
	var i, k, vals = [];

	if (keys) {
		for (i = 0; i < keys.length; i++) {
			vals.push(obj[keys[i]]);
		}
	} else if (Array.isArray(obj)) {
		for (i = 0; i < obj.length; i++) {
			vals.push(obj[i]);
		}
	} else {
		for (k in obj) {
			if (!/[0-9]+/.test(k)) {
				vals.push(obj[k]);
			}
		}
	}
	return vals;
};

// Qn:       is Zero a valid value for a FK column?
// Why?      Well I've got a pre-existing database that started all its 'serial' IDs at zero...
// Answer:   hasValues() is only used in hasOne association, so it's probably ok...
exports.hasValues = function (obj, keys) {
	for (var i = 0; i < keys.length; i++) {
		if (!obj[keys[i]] && obj[keys[i]] !== 0) return false;  // 0 is also a good value...
	}
	return true;
};

exports.populateConditions = function (model, fields, source, target, overwrite) {
	for (var i = 0; i < model.id.length; i++) {
		if (typeof target[fields[i]] === 'undefined' || overwrite !== false) {
			target[fields[i]] = source[model.id[i]];
		} else if (Array.isArray(target[fields[i]])) {
			target[fields[i]].push(source[model.id[i]]);
		} else {
			target[fields[i]] = [target[fields[i]], source[model.id[i]]];
		}
	}
};

exports.getConditions = function (model, fields, from) {
	var conditions = {};

	exports.populateConditions(model, fields, from, conditions);

	return conditions;
};

exports.wrapFieldObject = function (params) {
	if (!params.field) {
		var assoc_key = params.model.settings.get("properties.association_key");

		if (typeof assoc_key === "function") {
		    params.field = assoc_key(params.altName.toLowerCase(), params.model.id[0]);
		} else {
			params.field = assoc_key.replace("{name}", params.altName.toLowerCase())
			               .replace("{field}", params.model.id[0]);
		}
	}

	if (typeof params.field == 'object') {
		for (var k in params.field) {
			if (!/[0-9]+/.test(k) && params.field.hasOwnProperty(k)) {
				return params.field;
			}
		}
	}

	var newObj = {}, newProp, propPreDefined, propFromKey;

	propPreDefined = params.model.properties[params.field];
	propFromKey    = params.model.properties[params.model.id[0]];
	newProp        = { type: 'integer' };

	var prop = _.cloneDeep(propPreDefined || propFromKey || newProp);

	if (!propPreDefined) {
		_.extend(prop, {
			name: params.field, mapsTo: params.mapsTo || params.field
		});
	}

	newObj[params.field] = prop;

	return newObj;
};

exports.formatField = function (model, name, required, reversed) {
	var fields = {}, field_opts, field_name;
	var keys = model.id;
	var assoc_key = model.settings.get("properties.association_key");

	for (var i = 0; i < keys.length; i++) {
		if (reversed) {
			field_name = keys[i];
		} else if (typeof assoc_key === "function") {
			field_name = assoc_key(name.toLowerCase(), keys[i]);
		} else {
			field_name = assoc_key.replace("{name}", name.toLowerCase())
			                      .replace("{field}", keys[i]);
		}

		if (model.properties.hasOwnProperty(keys[i])) {
			var p = model.properties[keys[i]];

			field_opts = {
				type     : p.type || "integer",
				size     : p.size || 4,
				unsigned : p.unsigned || true,
				time     : p.time || false,
				big      : p.big || false,
				values   : p.values || null,
				required : required,
				name     : field_name,
				mapsTo   : field_name
			};
		} else {
			field_opts = {
				type     : "integer",
				unsigned : true,
				size     : 4,
				required : required,
				name     : field_name,
				mapsTo   : field_name
			};
		}

		fields[field_name] = field_opts;
	}

	return fields;
};

// If the parent associations key is `serial`, the join tables
// key should be changed to `integer`.
exports.convertPropToJoinKeyProp = function (props, opts) {
	var prop;

	for (var k in props) {
		prop = props[k];

		prop.required = opts.required;

		if (prop.type == 'serial') {
			prop.type = 'integer';
		}
		if (opts.makeKey) {
			prop.key = true;
		} else {
			delete prop.key;
		}
	}

	return props;
}

exports.getRealPath = function (path_str, stack_index) {
	var path = require("path"); // for now, load here (only when needed)
	var cwd = process.cwd();
	var err = new Error();
	var tmp = err.stack.split(/\r?\n/)[typeof stack_index !== "undefined" ? stack_index : 3], m;

	if ((m = tmp.match(/^\s*at\s+(.+):\d+:\d+$/)) !== null) {
		cwd = path.dirname(m[1]);
	} else if ((m = tmp.match(/^\s*at\s+module\.exports\s+\((.+?)\)/)) !== null) {
		cwd = path.dirname(m[1]);
	} else if ((m = tmp.match(/^\s*at\s+.+\s+\((.+):\d+:\d+\)$/)) !== null) {
		cwd = path.dirname(m[1]);
	}
	var pathIsAbsolute = path.isAbsolute || require('path-is-absolute');
	if (!pathIsAbsolute(path_str)) {
		path_str = path.join(cwd, path_str);
	}
	if (path_str.substr(-1) === path.sep) {
		path_str += "index";
	}

	return path_str;
};

exports.transformPropertyNames = function (dataIn, properties) {
	var k, prop;
	var dataOut = {};

	for (k in dataIn) {
		prop = properties[k];
		if (prop) {
			dataOut[prop.mapsTo] = dataIn[k];
		} else {
			dataOut[k] = dataIn[k];
		}
	}
	return dataOut;
};

exports.transformOrderPropertyNames = function (order, properties) {
	if (!order) return order;

	var i, item;
	var newOrder = JSON.parse(JSON.stringify(order));

	// Rename order properties according to mapsTo
	for (var i = 0; i < newOrder.length; i++) {
		item = newOrder[i];

		// orderRaw
		if (Array.isArray(item[1])) continue;

		if (Array.isArray(item[0])) {
			// order on a hasMany
			// [ ['modelName', 'propName'], 'Z']
			item[0][1] = properties[item[0][1]].mapsTo;
		} else {
			// normal order
			item[0] = properties[item[0]].mapsTo;
		}
	}
	return newOrder;
}

exports.renameDatastoreFieldsToPropertyNames = function (data, fieldToPropertyMap) {
	var k, prop;

	for (k in data) {
		prop = fieldToPropertyMap[k];
		if (prop && prop.name != k) {
			data[prop.name] = data[k];
			delete data[k];
		}
	}
	return data;
}

exports.renamePropertyNamesToDatastoreFields = function (data, fieldToPropertyMap) {
    var k, prop;

	for (prop in fieldToPropertyMap){
        for (k in data) {
            if (fieldToPropertyMap[prop].name === k) {
                data[prop] = data[k];
                delete data[k];
            }
        }

    }
    return data;
}
