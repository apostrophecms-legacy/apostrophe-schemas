var async = require('async');
var _ = require('lodash');
var extend = require('extend');
var fs = require('fs');
var moment = require('moment');

function ApostropheSchemas(options, callback) {
  var self = this;
  self._apos = options.apos;
  self._app = options.app;

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'schemas', __dirname, options);

  self.pushAsset('script', 'editor', { when: 'user' });

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
      var grouped = [];
      _.each(options.groupFields, function(group) {
        _.each(group.fields || [], function(name) {
          var field = _.find(schema, function(field) {
            return (field.name === name);
          });
          if (field) {
            field.group = group.name;
          } else {
            throw new Error('Nonexistent field ' + name + ' referenced by groups option in schemas.compose');
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

  // For custom types. For the builtin types we use macros.
  self.renders = {};

  // BEGIN CONVERTERS

  // Converters from various formats for various types. Define them all
  // for the csv importer, then copy that as a starting point for
  // regular forms and override those that are different (areas)
  self.converters = {};
  self.converters.csv = {
    area: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.textToArea(data[name]);
      return setImmediate(cb);
    },
    string: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeString(data[name], field.def);
      return setImmediate(cb);
    },
    slug: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.slugify(self._apos.sanitizeString(data[name], field.def));
      return setImmediate(cb);
    },
    tags: function(req, data, name, snippet, field, cb) {
      var tags;
      tags = self._apos.sanitizeString(data[name]);
      tags = self._apos.tagsToArray(tags);
      snippet[name] = tags;
      return setImmediate(cb);
    },
    boolean: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeBoolean(data[name], field.def);
      return setImmediate(cb);
    },
    select: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeSelect(data[name], field.choices, field.def);
      return setImmediate(cb);
    },
    integer: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeInteger(data[name], field.def, field.min, field.max);
      return setImmediate(cb);
    },
    float: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeFloat(data[name], field.def, field.min, field.max);
      return setImmediate(cb);
    },
    url: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeUrl(data[name], field.def);
      return setImmediate(cb);
    },
    date: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeDate(data[name], field.def);
      return setImmediate(cb);
    },
    time: function(req, data, name, snippet, field, cb) {
      snippet[name] = self._apos.sanitizeTime(data[name], field.def);
      return setImmediate(cb);
    },
    password: function(req, data, name, snippet, field, cb) {
      // Change the stored password hash only if a new value
      // has been offered
      var _password = self._apos.sanitizeString(data.password);
      if (_password.length) {
        snippet[name] = self._apos.hashPassword(data.password);
      }
      return setImmediate(cb);
    },
    group: function(req, data, name, snippet, field, cb) {
      // This is a visual grouping element and has no data
      return setImmediate(cb);
    }
  };
  // As far as the server is concerned a singleton is just an area
  self.converters.csv.singleton = self.converters.csv.area;

  self.converters.form = {};
  extend(self.converters.form, self.converters.csv, true);

  self.converters.form.singleton = self.converters.form.area = function(req, data, name, snippet, field, cb) {
    var content = [];
    try {
      content = JSON.parse(data[name]);
    } catch (e) {
      // Always recover graciously and import something reasonable, like an empty area
    }
    self._apos.sanitizeItems(content);
    snippet[name] = { items: content, type: 'area' };
    return setImmediate(cb);
  };

  self.converters.form.joinByOne = function(req, data, name, snippet, field, cb) {
    snippet[field.idField] = self._apos.sanitizeId(data[name]);
    return setImmediate(cb);
  };

  self.converters.form.joinByOneReverse = function(req, data, name, snippet, field, cb) {
    // Not edited on this side of the relation
    return setImmediate(cb);
  };

  self.converters.form.joinByArray = function(req, data, name, snippet, field, cb) {
    var input = data[name] || [];
    if (!Array.isArray(input)) {
      input = [];
    }
    snippet[field.idsField] = [];
    if (field.extras) {
      snippet[field.extrasField] = {};
    }

    // Clear old values before we sanitize new, so we don't get orphans
    if (field.relationshipsField) {
      snippet[field.relationshipsField] = {};
    }
    // Each element may be an id or an object with a 'value' property
    // containing the id as well as optional extra properties
    _.each(input, function(e) {
      var id;
      if (typeof(e) === 'object') {
        id = e.value;
      } else {
        id = e;
      }
      id = self._apos.sanitizeId(id);
      if (id !== undefined) {
        snippet[field.idsField].push(id);
        if (field.relationship) {
          if (typeof(e) !== 'object') {
            // Behave reasonably if we got just ids instead of objects
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
            } else {
              console.log(snippet.name + ': unknown type for attr attribute of relationship ' + name + ', ignoring');
            }
          });
          snippet[field.relationshipsField][id] = validatedRelationship;
        }
      }
    });
    return setImmediate(cb);
  };

  self.converters.form.joinByArrayReverse = function(req, data, name, snippet, field, cb) {
    // Not edited on this side of the relation
    return setImmediate(cb);
  };

  self.converters.form.tags = function(req, data, name, snippet, field, cb) {
    snippet[name] = self._apos.sanitizeTags(data[name]);
    return setImmediate(cb);
  };

  // END CONVERTERS

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
    var i;
    return async.each(schema, function(field, callback) {
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
      self.converters[from][field.type](req, data, field.name, object, field, callback);
    }, callback);
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
    // Only interested in joins
    var joins = _.filter(schema, function(field) {
      return !!self.joinrs[field.type];
    });
    if (objects.length > 1) {
      // Only interested in joins that are not restricted by ifOnlyOne.
      // This mechanism saves time and memory in cases where you don't need
      // the results of the join in index views
      joins = _.filter(joins, function(join) {
        return !join.ifOnlyOne;
      });
    }
    // The withJoins option allows restriction of joins. Set to false
    // it blocks all joins. Set to an array, it allows the joins named within.
    // If some of those names use dot notation, a chain of nested joins to be
    // permitted can be specified.
    //
    // By default, all configured joins will take place, but withJoins: false
    // will be passed when fetching the objects on the other end of the join,
    // so that infinite recursion never takes place.

    var withJoinsNext = {};
    // Explicit withJoins option passed to us
    if (Array.isArray(withJoins)) {
      joins = _.filter(joins, function(join) {
        var winner;
        _.each(withJoins, function(withJoinName) {
          if (withJoinName === join.name) {
            winner = true;
          }
          if (withJoinName.substr(0, join.name.length + 1) === (join.name + '.')) {
            if (!withJoinsNext[join.name]) {
              withJoinsNext[join.name] = [];
            }
            withJoinsNext[join.name].push(withJoinName.substr(join.name.length + 1));
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
          withJoinsNext[join.name] = join.withJoins;
        }
      });
    }
    return async.eachSeries(joins, function(join, callback) {
      if (!join.name.match(/^_/)) {
        console.error('WARNING: joins should always be given names beginning with an underscore (_). Otherwise you will waste space in your database storing the results');
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
        // Simple manager for a page type. If it has a getter, use it,
        // otherwise supply one
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
          withJoins: withJoinsNext[join.name] || false,
          permalink: true
        }
      };

      // Allow options to the getter to be specified in the schema,
      // notably editable: true
      _.extend(options.getOptions, join.getOptions || {});
      return self.joinrs[join.type](req, join, options, objects, callback);
    }, function(err) {
      return callback(err);
    });
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
  };

  // Render a custom field from nunjucks
  self._apos.addLocal('aposSchemaField', function(field) {
    // Alow custom renderers for types and for individual fields
    var render = field.render || self.renders[field.type];
    if (!render) {
      // Look for a standard render template in the views folder
      // of this module
      return self.renderer(field.type)(field);
    }
    return render(field);
  });

  if (callback) {
    return callback(null);
  }
}

module.exports = function(options, callback) {
  return new ApostropheSchemas(options, callback);
};
