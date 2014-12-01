/* jshint node:true */
var async = require('async');
var _ = require('lodash');
var extend = require('extend');

function ApostropheSchemas(options, callback) {
  var self = this;
  self._apos = options.apos;
  self._app = options.app;

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'schemas', __dirname, options);

  self.pushAsset('script', 'editor', { when: 'user' });
  self.pushAsset('stylesheet', 'editor', { when: 'user' });

  // We get constructed first so we need a method to inject the pages
  // module
  self.setPages = function(pages) {
    self._pages = pages;
  };

  // Compose a schema based on addFields, removeFields, orderFields
  // and, occasionally, alterFields options. This method is great for
  // merging the schema requirements of subclasses with the schema
  // requirements of a superclass. See the apostrophe-schemas documentation
  // for a thorough explanation of the use of each option. The
  // alterFields option should be avoided if your needs can be met
  // via another option.

  self.compose = function(options) {
    var schema = [];

    if (options.addFields) {
      var nextSplice = schema.length;
      _.each(options.addFields, function(field) {
        var i;
        for (i = 0; (i < schema.length); i++) {
          if (schema[i].name === field.name) {
            schema.splice(i, 1);
            if (!(field.before || field.after)) {
              // Replace it in its old position if none was explicitly requested
              schema.splice(i, 0, field);
              return;
            }
            // before or after requested, so fall through and let them work
            break;
          }
        }
        if (field.start) {
          nextSplice = 0;
        }
        if (field.end) {
          nextSplice = schema.length;
        }
        if (field.after) {
          for (i = 0; (i < schema.length); i++) {
            if (schema[i].name === field.after) {
              nextSplice = i + 1;
              break;
            }
          }
        }
        if (field.before) {
          for (i = 0; (i < schema.length); i++) {
            if (schema[i].name === field.before) {
              nextSplice = i;
              break;
            }
          }
        }
        schema.splice(nextSplice, 0, field);
        nextSplice++;
      });
    }

    if (options.removeFields) {
      schema = _.filter(schema, function(field) {
        return !_.contains(options.removeFields, field.name);
      });
    }

    if (options.orderFields) {
      var fieldsObject = {};
      var copied = {};
      _.each(schema, function(field) {
        fieldsObject[field.name] = field;
      });
      schema = [];
      _.each(options.orderFields, function(name) {
        if (fieldsObject[name]) {
          schema.push(fieldsObject[name]);
        }
        copied[name] = true;
      });
      _.each(fieldsObject, function(field, name) {
        if (!copied[name]) {
          schema.push(field);
        }
      });
    }

    if (options.requireFields) {
      _.each(options.requireFields, function(name) {
        var field = _.find(schema, function(field) {
          return field.name === name;
        });
        if (field) {
          field.required = true;
        }
      });
    }

    if (options.alterFields) {
      options.alterFields(schema);
    }

    // Convenience option for grouping fields
    // together (visually represented as tabs). Any
    // fields that are not grouped go to the top and
    // appear above the tabs
    if (options.groupFields) {
      // Drop any previous groups, we're overriding them
      schema = _.filter(schema, function(field) {
        return (field.type !== 'group');
      });
      _.each(schema, function(field) {
        delete field.group;
      });

      // Check for groups and fields with the same name, which is
      // forbidden because groups are internally represented as fields
      var nameMap = {};
      _.each(schema, function(field) {
        nameMap[field.name] = true;
      });
      _.each(options.groupFields, function(group) {
        if (_.has(nameMap, group.name)) {
          throw new Error('The group ' + group.name + ' has the same name as a field. Group names must be distinct from field names.');
        }
      });

      var ungrouped = [];
      _.each(options.groupFields, function(group) {
        _.each(group.fields || [], function(name) {
          var field = _.find(schema, function(field) {
            return (field.name === name);
          });
          if (field) {
            field.group = group.name;
          } else {
            // Tolerate nonexistent fields in groupFields. This
            // will happen if a subclass uses removeFields and
            // doesn't set up a new groupFields option, which
            // is reasonable
            return;
          }
        });
      });

      var newSchema = _.map(options.groupFields, function(group) {
        return {
          type: 'group',
          name: group.name,
          label: group.label,
          icon: group.label
        };
      });

      ungrouped = _.filter(schema, function(field) {
        return !field.group;
      });

      newSchema = newSchema.concat(ungrouped);

      _.each(options.groupFields, function(group) {
        newSchema = newSchema.concat(_.filter(schema, function(field) {
          return (field.group === group.name);
        }));
      });

      schema = newSchema;
    }

    _.each(schema, function(field) {
      if (field.template) {
        if (typeof(field.template) === 'string') {
          field.render = self.renderer(field.template);
          delete field.template;
        } else {
          field.render = field.template;
          delete field.template;
        }
      }
    });

    _.each(schema, function(field) {
      if (field.type === 'select') {
        _.each(field.choices, function(choice){
          if (choice.showFields) {
            if (!_.isArray(choice.showFields)) {
              throw new Error('The \'showFields\' property in the choices of a select field needs to be an array.');
            }
            _.each(choice.showFields, function(showFieldName){
              if (!_.find(schema, function(schemaField){ return schemaField.name == showFieldName; })) {
                console.error('WARNING: The field \'' + showFieldName + '\' does not exist in your schema, but you tried to toggle it\'s display with a select field using showFields. STAAAHHHHPP!');
              }
            });
          }
        });
      }
    });

    return schema;
  };

  // refine is like compose, but it starts with an existing schema array
  // and amends it via the same options as compose.
  self.refine = function(schema, _options) {
    var options = {};
    extend(true, options, _options);
    options.addFields = schema.concat(options.addFields || []);
    return self.compose(options);
  };

  // Return a new schema containing only the fields named in the
  // `fields` array, while maintaining existing group relationships.
  // Any empty groups are dropped. Do NOT include group names
  // in `fields`.

  self.subset = function(schema, fields) {

    var schemaSubset = _.filter(schema, function(field) {
      return _.contains(fields, field.name) || (field.type === 'group');
    });

    // Drop empty tabs
    var fieldsByGroup = _.groupBy(schemaSubset, 'group');
    schemaSubset = _.filter(schemaSubset, function(field) {
      return (field.type !== 'group') || (_.has(fieldsByGroup, field.name));
    });

    // Drop references to empty tabs
    _.each(schemaSubset, function(field) {
      if (field.group && (!_.find(schemaSubset, function(group) {
        return ((group.type === 'group') && (group.name === field.group));
      }))) {
        delete field.group;
      }
    });

    return schemaSubset;
  };

  // Return a new object with all default settings defined in the schema
  self.newInstance = function(schema) {
    var def = {};
    _.each(schema, function(field) {
      if (field.def !== undefined) {
        def[field.name] = field.def;
      }
    });
    return def;
  };

  self.subsetInstance = function(schema, instance) {
    var subset = {};
    _.each(schema, function(field) {
      if (field.type === 'group') {
        return;
      }
      if (!self.copiers[field]) {
        // These rules suffice for our standard fields
        subset[field.name] = instance[field.name];
        if (field.idField) {
          subset[field.idField] = instance[field.idField];
        }
        if (field.idsField) {
          subset[field.idsField] = instance[field.idsField];
        }
      } else {
        self.copiers[field](name, instance, subset, field);
      }
    });
    return subset;
  };

  // Determine whether an object is empty according to the schema.
  // Note this is not the same thing as matching the defaults. A
  // nonempty string or array is never considered empty. A numeric
  // value of 0 is considered empty

  self.empty = function(schema, object) {
    return !_.find(schema, function(field) {
      // Return true if not empty
      var value = object[field.name];
      if ((value !== null) && (value !== undefined) && (value !== false)) {
        if (!self.empties[field.type]) {
          // Type has no method to check emptiness, so assume not empty
          return true;
        }
        return !self.empties[field.type](field, value);
      }
    });
  };

  self.empties = {
    string: function(field, value) {
      return !value.length;
    },
    boolean: function(field, value) {
      return !value;
    },
    array: function(field, value) {
      return !value.length;
    },
    area: function(field, value) {
      return self._apos._aposLocals.aposAreaIsEmpty({ area: value });
    },
    singleton: function(field, value) {
      return self._apos._aposLocals.aposSingletonIsEmpty({ area: value, type: field.widgetType });
    }
  };

  self.renders = {};

  // BEGIN CONVERTERS

  // Converters from various formats for various types. Define them all
  // for the csv importer, then copy that as a starting point for
  // regular forms and override those that are different (areas)
  self.converters = {};
  self.converters.csv = {
    area: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.textToArea(data[name]);
      return setImmediate(callback);
    },
    string: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeString(data[name], field.def);
      return setImmediate(callback);
    },
    slug: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.slugify(self._apos.sanitizeString(data[name], field.def));
      return setImmediate(callback);
    },
    tags: function(req, data, name, snippet, field, callback) {
      var tags;
      tags = self._apos.sanitizeString(data[name]);
      tags = self._apos.tagsToArray(tags);
      snippet[name] = tags;
      return setImmediate(callback);
    },
    boolean: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeBoolean(data[name], field.def);
      return setImmediate(callback);
    },
    checkboxes: function(req, data, name, object, field, callback) {
        data[name] = self._apos.sanitizeString(data[name]).split(',');

        if (!Array.isArray(data[name])) {
          object[name] = [];
          return setImmediate(callback);
        }

        object[name] = _.filter(data[name], function(choice) {
          return _.contains(_.pluck(field.choices, 'value'), choice);
        });

        return setImmediate(callback);
    },
    select: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeSelect(data[name], field.choices, field.def);
      return setImmediate(callback);
    },
    integer: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeInteger(data[name], field.def, field.min, field.max);
      return setImmediate(callback);
    },
    float: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeFloat(data[name], field.def, field.min, field.max);
      return setImmediate(callback);
    },
    url: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeUrl(data[name], field.def);
      return setImmediate(callback);
    },
    date: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeDate(data[name], field.def);
      return setImmediate(callback);
    },
    time: function(req, data, name, snippet, field, callback) {
      snippet[name] = self._apos.sanitizeTime(data[name], field.def);
      return setImmediate(callback);
    },
    password: function(req, data, name, snippet, field, callback) {
      // Change the stored password hash only if a new value
      // has been offered
      var _password = self._apos.sanitizeString(data.password);
      if (_password.length) {
        snippet[name] = self._apos.hashPassword(data.password);
      }
      return setImmediate(callback);
    },
    group: function(req, data, name, snippet, field, callback) {
      // This is a visual grouping element and has no data
      return setImmediate(callback);
    },
    array: function(req, data, name, snippet, field, callback) {
      // We don't do arrays in CSV, it would be painful to work with
      return setImmediate(callback);
    },
    // Support for one-to-one joins in CSV imports,
    // by title or id of item joined with. Title match
    // is tolerant
    joinByOne: function(req, data, name, snippet, field, callback) {
      var manager = self._pages.getManager(field.withType);
      if (!manager) {
        return callback(new Error('join with type ' + field.withType + ' unrecognized'));
      }
      var titleOrId = self._apos.sanitizeString(data[name]);
      var criteria = { $or: [ { sortTitle: self._apos.sortify(titleOrId) }, { _id: titleOrId } ] };
      return manager.get(req, criteria, { fields: { _id: 1 } }, function(err, results) {
        if (err) {
          return callback(err);
        }
        results = results.pages || results.snippets;
        if (!results.length) {
          return callback(null);
        }
        snippet[field.idField] = results[0]._id;
        return callback(null);
      });
    },
    // Support for array joins in CSV imports,
    // by title or id of items joined with, in a comma-separated
    // list. Title match is tolerant, but you must NOT supply any
    // commas that may appear in the titles of the individual items,
    // since commas are reserved for separating items in the list
    joinByArray: function(req, data, name, snippet, field, callback) {
      var manager = self._pages.getManager(field.withType);
      if (!manager) {
        return callback(new Error('join with type ' + field.withType + ' unrecognized'));
      }
      var titlesOrIds = self._apos.sanitizeString(data[name]).split(/\s*,\s*/);
      if ((!titlesOrIds) || (titlesOrIds[0] === undefined)) {
        return setImmediate(callback);
      }
      var clauses = [];
      _.each(titlesOrIds, function(titleOrId) {
        clauses.push({ sortTitle: self._apos.sortify(titleOrId) });
        clauses.push({ _id: titleOrId });
      });
      return manager.get(req, { $or: clauses }, { fields: { _id: 1 }, withJoins: false }, function(err, results) {
        if (err) {
          return callback(err);
        }
        results = results.pages || results.snippets;
        snippet[field.idsField] = _.pluck(results, '_id');
        return callback(null);
      });
    },
    joinByOneReverse: function(req, data, name, snippet, field, callback) {
      // Importable as part of the *other* type
      return setImmediate(callback);
    },
    joinByArrayReverse: function(req, data, name, snippet, field, callback) {
      // Importable as part of the *other* type
      return setImmediate(callback);
    },
  };
  // As far as the server is concerned a singleton is just an area
  self.converters.csv.singleton = self.converters.csv.area;

  self.converters.form = {};
  extend(self.converters.form, self.converters.csv, true);

  self.converters.form.singleton = self.converters.form.area = function(req, data, name, snippet, field, callback) {
    var content = [];
    try {
      // If this is a full-fledged area object with a type property,
      // we're interested in the items property. For bc, if it's just an array,
      // assume it is already an array of items.
      content = (data[name].type === 'area') ? data[name].items : data[name];
    } catch (e) {
      // Always recover graciously and import something reasonable, like an empty area
    }
    return self._apos.sanitizeItems(req, content, function(err, items) {
      if (err) {
        return callback(err);
      }
      snippet[name] = { items: items, type: 'area' };
      return callback(null);
    });
  };

  // An array of objects with their own schema
  self.converters.form.array = function(req, data, name, snippet, field, callback) {
    var schema = field.schema;
    data = data[name];
    if (!Array.isArray(data)) {
      data = [];
    }
    var results = [];
    return async.eachSeries(data, function(datum, callback) {
      var result = {};
      result.id = self._apos.sanitizeId(datum.id) || self._apos.generateId();
      return self.convertFields(req, schema, 'form', datum, result, function(err) {
        if (err) {
          return callback(err);
        }
        results.push(result);
        return callback(null);
      });
    }, function(err) {
      snippet[name] = results;
      return callback(err);
    });
  };

  self.converters.form.joinByOne = function(req, data, name, snippet, field, callback) {
    snippet[field.idField] = self._apos.sanitizeId(data[field.idField]);
    return setImmediate(callback);
  };

  self.converters.form.joinByOneReverse = function(req, data, name, snippet, field, callback) {
    // Not edited on this side of the relation
    return setImmediate(callback);
  };

  self.converters.form.joinByArray = function(req, data, name, snippet, field, callback) {
    snippet[field.idsField] = self._apos.sanitizeIds(data[field.idsField]);

    snippet[field.relationshipsField] = {};

    _.each(snippet[field.idsField], function(id) {
      var e = data[field.relationshipsField] && data[field.relationshipsField][id];
      if (!e) {
        e = {};
      }
      // Validate the relationship (aw)
      var validatedRelationship = {};
      _.each(field.relationship, function(attr) {
        if (attr.type === 'string') {
          validatedRelationship[attr.name] = self._apos.sanitizeString(e[attr.name]);
        } else if (attr.type === 'boolean') {
          validatedRelationship[attr.name] = self._apos.sanitizeBoolean(e[attr.name]);
        } else if (attr.type === 'select') {
          validatedRelationship[attr.name] = self._apos.sanitizeSelect(e[attr.name], attr.choices);
        } else if (attr.type === 'tags') {
          validatedRelationship[attr.name] = self._apos.sanitizeTags(e[attr.name]);
        } else {
          console.error(snippet.name + ': unknown type for attr attribute of relationship ' + name + ', ignoring');
        }
      });
      snippet[field.relationshipsField][id] = validatedRelationship;
    });
    return setImmediate(callback);
  };

  self.converters.form.joinByArrayReverse = function(req, data, name, snippet, field, callback) {
    // Not edited on this side of the relation
    return setImmediate(callback);
  };

  self.converters.form.tags = function(req, data, name, snippet, field, callback) {
    var tags = self._apos.sanitizeTags(data[name]);
    if (!self._apos.options.lockTags) {
      snippet[field.name] = tags;
      return setImmediate(callback);
    }
    return self._apos.getTags({ tags: tags }, function(err, tags) {
      if (err) {
        return callback(err);
      }
      //enforce limit if provided, take first N elements
      if (field.options && field.options.limit) {
        tags = tags.slice(0, field.options.limit);
      }
      snippet[field.name] = tags;
      return callback(null);
    });
  };

  self.converters.form.checkboxes = function(req, data, name, object, field, callback) {
    if (!Array.isArray(data[name])) {
      object[name] = [];
      return setImmediate(callback);
    }

    object[name] = _.filter(data[name], function(choice) {
      return _.contains(_.pluck(field.choices, 'value'), choice);
    });

    return setImmediate(callback);
  };

  // END CONVERTERS


  // BEGIN EPORTERS

  // Exporters from various formats for CSV, plain text output. 
  self.exporters = {};
  self.exporters.csv = {
    string: function(req, snippet, field, name, output, callback) {
      // no formating, set the field
      output[name] = snippet[name];
      return setImmediate(callback);
    },
    select: function(req, snippet, field, name, output, callback) {
      output[name] = snippet[name] || '';
      return setImmediate(callback);
    },
    slug: function(req, snippet, field, name, output, callback) {
      // no formating, set the field
      output[name] = snippet[name];
      return setImmediate(callback);
    },
    tags: function(req, snippet, field, name, output, callback) {
      output[name] = snippet[name].toString();
      return setImmediate(callback);
    },
    boolean: function(req, snippet, field, name, output, callback) {
      output[name] = self._apos.sanitizeBoolean(snippet[name]).toString();
      return setImmediate(callback);
    },
    group: function(req, snippet, field, name, output, callback) {
      // This is a visual grouping element and has no data
      return setImmediate(callback);
    },
    a2Groups: function(req, snippet, field, name, output, callback) {
      // This is a visual grouping element and has no data
      return setImmediate(callback);
    },
    password: function(req, snippet, field, name, output, callback) {
      // don't export
      return setImmediate(callback);
    },
    a2Permissions: function(req, snippet, field, name, output, callback) {
      // don't export
      return setImmediate(callback);
    },
  }

  // Make each type of schema field searchable. You can shut this off
  // for any field by setting its `search` option to false. Not all
  // field types make sense for search. Areas and singletons are always
  // searchable. The `weight` option makes a property more significant
  // in search; in the current implementation weights greater than 10
  // are treated more prominently. By default all schema fields are
  // treated as more important than ordinary body text. You can change
  // that by setting a lower weight. The "silent" option, which is true
  // by default, prevents the field from showing up in the summary of
  // the item presented with search results.

  self.indexers = {
    string: function(value, field, texts) {
      var silent = (field.silent === undefined) ? true : field.silent;
      texts.push({ weight: field.weight || 15, text: value, silent: silent });
    },
    checkboxes: function(value, field, texts) {
      var silent = (field.silent === undefined) ? true : field.silent;
      texts.push({ weight: field.weight || 15, text: (value || []).join(' '), silent: silent });
    },
    select: function(value, field, texts) {
      var silent = (field.silent === undefined) ? true : field.silent;
      texts.push({ weight: field.weight || 15, text: value, silent: silent });
    }
    // areas and singletons are always indexed by apostrophe-pages
  };

  // Index the object's fields for participation in Apostrophe search
  self.indexFields = function(schema, object, lines) {
    _.each(schema, function(field) {
      if (field.search === false) {
        return;
      }
      if (!self.indexers[field.type]) {
        return;
      }
      self.indexers[field.type](object[field.name], field, lines);
    });
  };

  // Convert submitted `data`, sanitizing it and populating `object` with it
  self.convertFields = function(req, schema, from, data, object, callback) {
    if (arguments.length !== 6) {
      throw new Error("convertFields now takes 6 arguments, with req added in front and callback added at the end");
    }
    if (!req) {
      throw new Error("convertFields invoked without a req, do you have one in your context?");
    }
    return async.eachSeries(schema, function(field, callback) {
      // Fields that are contextual are edited in the context of a
      // show page and do not appear in regular schema forms. They are
      // however legitimate in imports, so we make sure it's a form
      // and not a CSV that we're skipping it for.
      if (field.contextual && (from === 'form')) {
        return callback();
      }
      if (!self.converters[from][field.type]) {
        throw new Error("No converter exists for schema field type " + field.type + ", field definition was: " + JSON.stringify(field));
      }
      if (self.converters[from][field.type].length !== 6) {
        console.error(self.converters[from][field.type].toString());
        throw new Error("Schema converter methods must now take the following arguments: req, data, field.name, object, field, callback. They must also invoke the callback.");
      }
      return self.converters[from][field.type](req, data, field.name, object, field, function(err) {
        return callback(err);
      });
    }, function(err) {
      return callback(err);
    });
  };

  // Export santized 'snippet' into 'object'
  self.exportFields = function(req, schema, to, snippet, object, callback) {
    if (arguments.length !== 6) {
      throw new Error("exportFields now takes 6 arguments, with req added in front and callback added at the end");
    }
    if (!req) {
      throw new Error("exportFields invoked without a req, do you have one in your context?");
    }
    return async.eachSeries(schema, function(field, callback) {

      if (!self.exporters[to][field.type]) {
        console.log("ERROR: No exporter exists for schema field type " + field.type + ", field definition was: " + JSON.stringify(field));
        console.log("You can add support for this field type in schemas.exporters");
        return callback(null);
      }
      if (self.exporters[to][field.type].length !== 6) {
        console.error(self.exporters[to][field.type].toString());
        throw new Error("Schema export methods must now take the following arguments: req, snippet, field, field.name, output, callback. They must also invoke the callback.");
      }
      return self.exporters[to][field.type](req, snippet, field, field.name, object, function(err) {
        return callback(err);
      });
    }, function(err) {
      return callback(err);
    });
  };

  // Used to implement 'join', below
  self.joinrs = {
    joinByOne: function(req, field, options, objects, callback) {
      return self._apos.joinByOne(req, objects, field.idField, field.name, options, callback);
    },
    joinByOneReverse: function(req, field, options, objects, callback) {
      return self._apos.joinByOneReverse(req, objects, field.idField, field.name, options, callback);
    },
    joinByArray: function(req, field, options, objects, callback) {
      return self._apos.joinByArray(req, objects, field.idsField, field.relationshipsField, field.name, options, callback);
    },
    joinByArrayReverse: function(req, field, options, objects, callback) {
      return self._apos.joinByArrayReverse(req, objects, field.idsField, field.relationshipsField, field.name, options, callback);
    }
  };

  // Carry out all the joins in the schema on the specified object or array
  // of objects. The withJoins option may be omitted.
  //
  // If withJoins is omitted, null or undefined, all the joins in the schema
  // are performed, and also any joins specified by the 'withJoins' option of
  // each join field in the schema, if any. And that's where it stops. Infinite
  // recursion is not possible.
  //
  // If withJoins is specified and set to "false", no joins at all are performed.
  //
  // If withJoins is set to an array of join names found in the schema, then
  // only those joins are performed, ignoring any 'withJoins' options found in
  // the schema.
  //
  // If a join name in the withJoins array uses dot notation, like this:
  //
  // _events._locations
  //
  // Then the objects are joined with events, and then the events are further
  // joined with locations, assuming that _events is defined as a join in the
  // schema and _locations is defined as a join in the schema for the events
  // module. Multiple "dot notation" joins may share a prefix.
  //
  // Joins are also supported in the schemas of array fields.

  self.join = function(req, schema, objectOrArray, withJoins, callback) {
    if (arguments.length === 3) {
      callback = withJoins;
      withJoins = undefined;
    }

    if (withJoins === false) {
      // Joins explicitly deactivated for this call
      return callback(null);
    }

    var objects = _.isArray(objectOrArray) ? objectOrArray : [ objectOrArray ];
    if (!objects.length) {
      // Don't waste effort
      return callback(null);
    }

    // build an array of joins of interest, found at any level
    // in the schema, even those nested in array schemas. Add
    // an _arrays property to each one which contains the names
    // of the array fields leading to this join, if any, so
    // we know where to store the results. Also set a
    // _dotPath property which can be used to identify relevant
    // joins when the withJoins option is present

    var joins = [];

    function findJoins(schema, arrays) {
      var _joins = _.filter(schema, function(field) {
        return !!self.joinrs[field.type];
      });
      _.each(_joins, function(join) {
        if (!arrays.length) {
          join._dotPath = join.name;
        } else {
          join._dotPath = arrays.join('.') + '.' + join.name;
        }
        // If we have more than one object we're not interested in joins
        // with the ifOnlyOne restriction right now.
        if ((objects.length > 1) && join.ifOnlyOne) {
          return;
        }
        join._arrays = _.clone(arrays);
      });
      joins = joins.concat(_joins);
      _.each(schema, function(field) {
        if (field.type === 'array') {
          findJoins(field.schema, arrays.concat(field.name));
        }
      });
    }

    findJoins(schema, []);

    // The withJoins option allows restriction of joins. Set to false
    // it blocks all joins. Set to an array, it allows the joins named within.
    // Dot notation can be used to specify joins in array properties,
    // or joins reached via other joins.
    //
    // By default, all configured joins will take place, but withJoins: false
    // will be passed when fetching the objects on the other end of the join,
    // so that infinite recursion never takes place.

    var withJoinsNext = {};
    // Explicit withJoins option passed to us
    if (Array.isArray(withJoins)) {
      joins = _.filter(joins, function(join) {
        var dotPath = join._dotPath;
        var winner;
        _.each(withJoins, function(withJoinName) {
          if (withJoinName === dotPath) {
            winner = true;
            return;
          }
          if (withJoinName.substr(0, dotPath.length + 1) === (dotPath + '.')) {
            if (!withJoinsNext[dotPath]) {
              withJoinsNext[dotPath] = [];
            }
            withJoinsNext[dotPath].push(withJoinName.substr(dotPath.length + 1));
            winner = true;
          }
        });
        return winner;
      });
    } else {
      // No explicit withJoins option for us, so we do all the joins
      // we're configured to do, and pass on the withJoins options we
      // have configured for those
      _.each(joins, function(join) {
        if (join.withJoins) {
          withJoinsNext[join._dotPath] = join.withJoins;
        }
      });
    }

    return async.eachSeries(joins, function(join, callback) {
      var arrays = join._arrays;

      function findObjectsInArrays(objects, arrays) {
        if (!arrays) {
          return [];
        }
        if (!arrays.length) {
          return objects;
        }
        var array = arrays[0];
        var _objects = [];
        _.each(objects, function(object) {
          _objects = _objects.concat(object[array] || []);
        });
        return findObjectsInArrays(_objects, arrays.slice(1));
      }

      var _objects = findObjectsInArrays(objects, arrays);

      if (!join.name.match(/^_/)) {
        return callback(new Error('Joins should always be given names beginning with an underscore (_). Otherwise we would waste space in your database storing the results statically. There would also be a conflict with the array field withJoins syntax. Join name is: ' + join._dotPath));
      }
      var manager = self._pages.getManager(join.withType);
      if (!manager) {
        return callback('I cannot find the instance type ' + join.withType + ', maybe you said "map" where you should have said "mapLocation"?');
      }

      var getter;
      if (manager._instance) {
        // Snippet type manager, has instance and index types, figure out
        // which one we are looking for
        if (manager._instance === join.withType) {
          getter = manager.get;
        } else {
          getter = manager.getIndexes;
        }
      } else {
        // If it has a getter, use it, otherwise supply one
        getter = manager.get || function(req, _criteria, filters, callback) {
          var criteria = {
            $and: [
              {
                type: join.withType
              },
              _criteria
            ]
          };
          return apos.get(req, criteria, filters, callback);
        };
      }

      var options = {
        // Support joining with both instance and index types. If the manager's
        // instance type matches, use .get, otherwise use .getIndexes
        get: getter,
        getOptions: {
          withJoins: withJoinsNext[join._dotPath] || false,
          permalink: true
        }
      };

      // Allow options to the get() method to be
      // specified in the join configuration
      if (join.getOptions) {
        _.extend(options.getOptions, join.getOptions);
      }

      // Allow options to the getter to be specified in the schema,
      // notably editable: true
      _.extend(options.getOptions, join.getOptions || {});
      return self.joinrs[join.type](req, join, options, _objects, callback);
    }, callback);
  };

  // Add a new field type. Note that the template property of the type object
  // should be a function that renders a template, not a template filename.

  self.addFieldType = function(type) {
    // template is accepted for bc but it was always a function, so
    // render is a much better name
    self.renders[type.name] = type.render || type.template;
    self.converters.csv[type.name] = type.converters.csv;
    self.converters.form[type.name] = type.converters.form;
    self.indexers[type.name] = type.indexer;
    self.empties[type.name] = type.empty;
    self.copiers[type.name] = self.copier;
  };

  // Render a field from nunjucks
  self._apos.addLocal('aposSchemaField', function(field) {
    // Alow custom renderers for types and for individual fields
    var render = field.render || self.renders[field.type];
    if (!render) {
      // Look for a standard render template in the views folder
      // of this module
      return self.renderer(field.type)(field).trim();
    }
    return render(field).trim();
  });

  self.copiers = {};

  if (callback) {
    return callback(null);
  }
}

module.exports = function(options, callback) {
  return new ApostropheSchemas(options, callback);
};
