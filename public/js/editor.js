function AposSchemas() {
  var self = this;

  // Populate form elements corresponding to a set of fields as specified in a schema
  // (the schema argument). The inverse of self.convertSomeFields
  self.populateFields = function($el, schema, snippet, callback) {
    // This is a workaround for the lack of async.each client side.
    // Think about bringing that into the browser.
    function populateField(i) {
      if (i >= schema.length) {
        return callback(null);
      }
      var field = schema[i];

      // Not all displayers use this
      var $field = $el.findByName(field.name);

      // If this field maps to a plain HTML element set the
      // required attribute when appropriate. See:
      // http://stackoverflow.com/questions/18770369/how-to-set-html5-required-attribute-in-javascript
      // for why I do it this way.

      if (field.required && $field[0]) {
        $field[0].required = true;
      }

      // This is a hack to implement async.eachSeries. TODO: think about putting
      // the async module in the browser
      return self.displayers[field.type](snippet, field.name, $field, $el, field, function() {
        if (field.autocomplete === false) {
          $field.attr('autocomplete', 'off');
        }
        return populateField(i + 1);
      });
    }
    return populateField(0);
  };

  // Gather data from form elements and push it into properties of the data object,
  // as specified by the schema provided. The inverse of self.populateSomeFields
  self.convertFields = function($el, schema, data, callback) {
    $el.find('[data-name]').removeClass('apos-error');
    var failing;
    _.each(schema, function(field) {
      if (field.contextual) {
        return;
      }
      // This won't be enough for every type of field, so we pass $el too
      var $field = $el.findByName(field.name);
      if (!$field.length) {
        $field = $el.findByName(field.legacy);
      }
      var result = self.converters[field.type](data, field.name, $field, $el, field);
      if (result) {
        apos.log(result);
        apos.log('addError');
        self.addError($el, field.name);
        failing = field;
      }
    });
    return callback(failing);
  };

  self.enableSingleton = function($el, name, area, type, optionsArg, callback) {
    if (typeof(optionsArg) === 'function') {
      callback = optionsArg;
      optionsArg = {};
    }
    var items = [];
    if (area && area.items) {
      items = area.items;
    }

    var options = {};
    $.extend(options, optionsArg);
    $.extend(options, {
      type: type
    });

    refreshSingleton(items, callback);

    function refreshSingleton(items, callback) {
      options.content = JSON.stringify(items);
      $.post('/apos/edit-virtual-singleton', options, function(data) {
        var $editView = $el.find('[data-' + name + '-edit-view]');
        $editView.html('');
        $editView.append(data);

        // getSingletonJSON will pick it up from here
        $editView.data('items', items);

        // If an edit takes place, refresh so we can see the new preview here
        // in the form. This isn't an issue with areas since they are always
        // in the edit state in a form. TODO: consider whether it would be
        // better to create a container that allows widgets to be rendered
        // inline, without a nested dialog box

        var $singleton = $editView.find('.apos-singleton:first');
        $singleton.on('aposEdited', function(e, data) {
          refreshSingleton([data], function() {
            // A change event on the singleton's wrapper signifies
            // that getSingletonItem and getSingletonJSON can now be
            // called to see the new data
            $el.find('[data-name="' + name + '"]').trigger('change');
          });
        });

        if (callback) {
          return callback(null);
        }
      });
    }
  };

  // options argument may be skipped
  self.enableArea = function($el, name, area, options, callback) {
    if (!callback) {
      callback = options;
      options = {};
    }
    var items = [];
    if (area && area.items) {
      items = area.items;
    }
    $.post('/apos/edit-virtual-area', { content: JSON.stringify(items), options: JSON.stringify(options) }, function(data) {
      var $editView = $el.find('[data-' + name + '-edit-view]');
      $editView.append(data);
      return callback(null);
    });
  };

  // Access the widget data for a particular singleton
  self.getSingletonItem = function($el, name) {
    var items = $el.find('[data-' + name + '-edit-view]').data('items');
    items = items || [];
    return items[0];
  };

  // Retrieve a JSON string to serialize the singleton
  self.getSingletonJSON = function($el, name) {
    var items = $el.find('[data-' + name + '-edit-view]').data('items');
    items = items || [];
    return JSON.stringify(items);
  };

  // Retrieve a JSON string to serialize the area
  self.getAreaJSON = function($el, name) {
    var $property = $el.find('[data-' + name + '-edit-view]');
    return apos.stringifyArea($property.find('.apos-area:first'));
  };

  // Methods to convert from a form field of each schema type
  // to a property of the snippet ready to save. The server does
  // all the validation of course, since you can't trust a browser
  // anyway, so this is mostly simple except where the representation
  // in the form differs greatly from the representation the server wants
  self.converters = {
    // Convert the tough cases
    area: function(data, name, $field, $el, field) {
      data[name] = self.getAreaJSON($el, name);
      // TODO: this is very lazy and doesn't bother to look for things
      // like widgets with nothing in them. We should think seriously about
      // server side validation at this point.
      if (field.required && ((data[name] === '[]') || (data[name] === '[{"type":"richText","content":""}]'))) {
        return 'required';
      }
    },
    singleton: function(data, name, $field, $el, field) {
      data[name] = self.getSingletonJSON($el, name);
      if (field.required && ((data[name] === '[]') || (data[name] === '[{"type":"richText","content":""}]'))) {
        return 'required';
      }
    },
    joinByOne: function(data, name, $field, $el, field) {
      // Fix $field since we can't use the regular name attribute here
      $field = $el.find('[data-name="' + name + '"]');
      // The server will do the work of moving it to the idField as needed
      data[name] = $field.selective('get', { incomplete: true })[0];
      if (field.required && !data[name]) {
        return 'required';
      }
    },
    joinByOneReverse: function(data, name, $field, $el, field) {
      // Not edited on this side of the relation
    },
    joinByArray: function(data, name, $field, $el, field) {
      // Fix $field since we can't use the regular name attribute here
      $field = $el.find('[data-name="' + name + '"]');
      // The server will do the work of processing it all into
      // the relationshipsField and idsField separately for us if needed
      data[name] = $field.selective('get', { incomplete: true });
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    joinByArrayReverse: function(data, name, $field, $el, field) {
      // Not edited on this side of the relation
    },
    group: function(data, name, $field, $el, field) {
      // Just a presentation thing
    },
    // The rest are very simple because the server does
    // the serious sanitization work and the representation in the DOM
    // is a simple form element
    string: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    password: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    slug: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    tags: function(data, name, $field, $el, field) {
      data[name] = $el.find('[data-name="' + name + '"]').selective('get', { incomplete: true });
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    boolean: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      // Seems odd but sometimes used to mandate an "I agree" box
      if (field.required && !data[name]) {
        return 'required';
      }
    },
    select: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    integer: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    float: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    url: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    date: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
    time: function(data, name, $field, $el, field) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return 'required';
      }
    },
  };

  // Methods to display all of the field types supported by the schema
  self.displayers = {
    area: function(data, name, $field, $el, field, callback) {
      return self.enableArea($el, name, data[name], field.options || {}, callback);
    },
    singleton: function(data, name, $field, $el, field, callback) {
      return self.enableSingleton($el, name, data[name], field.widgetType, field.options || {}, callback);
    },
    string: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    password: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    slug: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    tags: function(data, name, $field, $el, field, callback) {
      apos.enableTags($el.find('[data-name="' + name + '"]'), data[name]);
      return callback();
    },
    url: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    select: function(data, name, $field, $el, field, callback) {
      var $options = $field.find('option');
      // Synthesize options from the choices in the schema, unless
      // the frontend developer has chosen to do it for us
      if (!$options.length) {
        _.each(field.choices, function(choice) {
          var $option = $('<option></option>');
          $option.text(choice.label);
          $option.attr('value', choice.value);
          $field.append($option);
        });
      }
      if ((!data._id) && field.def) {
        $field.val(field.def);
      } else {
        $field.val(data[name]);
      }
      return callback();
    },
    integer: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    float: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return callback();
    },
    boolean: function(data, name, $field, $el, field, callback) {
      $field.val(data[name] ? '1' : '0');
      return callback();
    },
    joinByOne: function(data, name, $field, $el, field, callback) {
      // Since we can't use a regular name attribute for a div
      $field = $el.find('[data-name="' + name + '"]');
      if (!$field.length) {
        apos.log('Error: your new.html template for the ' + self.name + ' module does not have a snippetSelective call for the ' + name + ' join yet');
      }
      var selectiveData = [];
      var id = data[field.idField];
      if (id) {
        // Let jQuery selective call back for the details
        selectiveData.push(id);
      }
      // For now this is still correct on the browser side, getManager
      // always returns undefined for an index type
      var manager = aposPages.getManager(field.withType);
      var autocomplete = '/apos-pages/autocomplete';
      if (manager) {
        autocomplete = manager._action + '/autocomplete';
      }
      $field.selective({ limit: 1, data: selectiveData, source: autocomplete });
      return callback();
    },
    joinByOneReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on the reverse side
      return callback();
    },
    joinByArray: function(data, name, $field, $el, field, callback) {
      // Since we can't use a regular name attribute for a div
      $field = $el.find('[data-name="' + name + '"]');
      if (!$field.length) {
        apos.log('Error: your new.html template for the ' + self.name + ' module does not have a snippetSelective call for the ' + name + ' join yet');
      }
      var selectiveData = [];
      _.each(data[field.name] || [], function(friend) {
        var datum = {};
        if (field.relationshipsField) {
          $.extend(true, datum, friend.relationship);
          // Fix booleans to match the select element's options
          _.each(field.relationship, function(relField) {
            if (relField.type === 'boolean') {
              datum[relField.name] = datum[relField.name] ? '1' : '0';
            }
          });
          // Present these as jQuery Selective expects us to
          datum.label = friend.item.title;
          datum.value = friend.item._id;
        } else {
          datum.label = friend.title;
          datum.value = friend._id;
        }
        selectiveData.push(datum);
      });
      // For now this is still correct on the browser side, getManager
      // always returns undefined for an index type
      var manager = aposPages.getManager(field.withType);
      var autocomplete = '/apos-pages/autocomplete?type=' + field.withType;
      if (manager) {
        autocomplete = manager._action + '/autocomplete';
      }
      $field.selective({ preventDuplicates: true, sortable: field.sortable, extras: !!field.relationship, data: selectiveData, source: autocomplete });
      return callback();
    },
    joinByArrayReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on the reverse side
      return callback();
    },
    group: function(data, name, $field, $el, field, callback) {
      // Just a presentation thing
      return callback();
    },
    date: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      apos.enhanceDate($field);
      if (field.legacy) {
        apos.enhanceDate($el.findByName(field.legacy));
      }
      return callback();
    },
    time: function(data, name, $field, $el, field, callback) {
      if (data[name] && data[name].length) {
        // Revert to local time for editing
        $field.val(apos.formatTime(data[name]));
      }
      return callback();
    },
  };

  self.addFieldType = function(type) {
    self.displayers[type.name] = type.displayer;
    self.converters[type.name] = type.converter;
  };

  // A convenience method for calling attention to errors in fields in your own
  // independent validation code.

  self.addError = function($el, name) {
    $el.find('[data-name="' + name + '"]').addClass('apos-error');
  };

  // A convenience allowing you to scroll to the first error present,
  // if any. Not called automatically. You can call this when
  // convertFields passes an error or when your own validation code
  // has invoked addError().

  self.scrollToError = function($el) {
    var $element = $el.find('.apos-error');
    if (!$element.length) {
      return;
    }
    var offset = $element.offset();
    var scrollTop = offset.top - 100;
    $('html, body').scrollTop(scrollTop);
    $element.find('input,select,textarea').first().focus();
  };
}

// Instantiate the singleton
var aposSchemas = new AposSchemas();
