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

      // Utilized by simple displayers that use a simple HTML
      // element with a name attribute
      var $field = self.findField($el, field.name);

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
    self.findSafe($el, '[data-name]').removeClass('apos-error');
    var failing;

    // async for loop
    var i = 0;
    function convertField() {
      if (i === schema.length) {
        return apos.afterYield(_.partial(callback, failing));
      }
      var field = schema[i];
      if (field.contextual) {
        i++;
        return apos.afterYield(convertField);
      }
      // This won't be enough for every type of field, so we pass $el too
      var $field = self.findField($el, field.name);
      if (!$field.length) {
        $field = self.findField($el, field.legacy);
      }
      return self.converters[field.type](data, field.name, $field, $el, field, function(err) {
        if (err) {
          self.addError($el, field.name);
          failing = field;
        }
        i++;
        return apos.afterYield(convertField);
      });
    }
    convertField();
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

    var $fieldset = self.findFieldset($el, name);
    refreshSingleton(items, callback);

    function refreshSingleton(items, callback) {
      options.content = items;
      $.jsonCall('/apos/edit-virtual-singleton', { dataType: 'html' }, options, function(data) {
        var $editView = self.findSafe($fieldset, '[data-' + name + '-edit-view]');
        $editView.html('');
        $editView.append(data);

        // getSingleton will pick it up from here
        $editView.data('items', items);

        // If an edit takes place, refresh so we can see the new preview here
        // in the form. This isn't an issue with areas since they are always
        // in the edit state in a form. TODO: consider whether it would be
        // better to create a container that allows widgets to be rendered
        // inline, without a nested dialog box

        var $singleton = self.findSafe($editView, '.apos-singleton:first');
        $singleton.on('aposEdited', function(e, data) {
          refreshSingleton([data], function() {
            // A change event on the singleton's wrapper signifies
            // that getSingleton can now be
            // called to see the new data
            $fieldset.trigger('change');
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
    var $fieldset = self.findFieldset($el, name);
    $.jsonCall('/apos/edit-virtual-area',
      { dataType: 'html' },
      { content: items, options: options }, function(data) {
      var $editView = self.findSafe($fieldset, '[data-' + name + '-edit-view]');
      $editView.append(data);
      return callback(null);
    });
  };

  // Retrieve a JSON-friendly serialization of the singleton
  self.getSingleton = function($el, name) {
    var $fieldset = self.findFieldset($el, name);
    var items = self.findSafe($fieldset, '[data-' + name + '-edit-view]').data('items');
    items = items || [];
    return items;
  };

  // Retrieve a JSON-friendly serialization of the area
  self.getArea = function($el, name) {
    var $fieldset = self.findFieldset($el, name);
    var $property = self.findSafe($fieldset, '[data-' + name + '-edit-view]');
    return $property.find('.apos-area:first').data('editor').serialize();
  };

  // Methods to convert from a form field of each schema type
  // to a property of the snippet ready to save. The server does
  // all the validation of course, since you can't trust a browser
  // anyway, so this is mostly simple except where the representation
  // in the form differs greatly from the representation the server wants
  self.converters = {
    // Convert the tough cases
    area: function(data, name, $field, $el, field, callback) {
      data[name] = self.getArea($el, name);
      console.log('area data is:');
      console.log(data[name]);

      if (field.required && (apos.areaIsEmpty(data[name]))) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    singleton: function(data, name, $field, $el, field, callback) {
      data[name] = self.getSingleton($el, name);
      console.log('singleton data is:');
      console.log(data[name]);
      if (field.required && (apos.singletonIsEmpty(data[name], field.type))) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    array: function(data, name, $field, $el, field, callback) {
      var results = [];
      var $fieldset = self.findFieldset($el, name);
      var $elements = self.findSafe($fieldset, '[data-element]:not(.apos-template)');

      var i = 0;

      var err;

      function convertElement() {
        if (i === $elements.length) {
          data[name] = results;
          return apos.afterYield(_.partial(callback, err));
        }
        var result = {};
        var $element = $($elements[i]);
        return self.convertFields($element, field.schema, result, function(_err) {
          if (_err) {
            err = _err;
          }
          results.push(result);
          i++;
          return apos.afterYield(convertElement);
        });
      }

      convertElement();
    },
    joinByOne: function(data, name, $field, $el, field, callback) {
      // Fix $field since we can't use the regular name attribute here
      $field = self.findSafe($el, '[data-name="' + name + '"]');
      data[field.idField] = $field.selective('get', { incomplete: true })[0];
      if (field.required && !data[name]) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    joinByOneReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on this side of the relation
      return apos.afterYield(callback);
    },
    joinByArray: function(data, name, $field, $el, field, callback) {
      // Fix $field since we can't use the regular name attribute here
      $field = self.findSafe($el, '[data-name="' + name + '"]');
      var info = $field.selective('get', { incomplete: true });
      if (field.relationshipField) {
        data[field.idsField] = _.pluck(info, 'value');
        data[field.relationshipField] = {};
        var relationship = {};
        _.each(info, function(e) {
          relationship[e.value] = _.omit(e, [ 'value', 'label' ]);
        });
        data[field.relationshipField] = relationship;
      } else {
        data[field.idsField] = info;
      }
      if (field.required && !data[field.idsField].length) {
        return apos.afterYield(function() {
          return apos.afterYield(_.partial(callback, 'required'));
        });
      }
      return apos.afterYield(callback);
    },
    joinByArrayReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on this side of the relation
      return apos.afterYield(callback);
    },
    group: function(data, name, $field, $el, field, callback) {
      // Just a presentation thing
      return apos.afterYield(callback);
    },
    // The rest are very simple because the server does
    // the serious sanitization work and the representation in the DOM
    // is a simple form element
    string: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    password: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    slug: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    tags: function(data, name, $field, $el, field, callback) {
      data[name] = self.findSafe($el, '[data-name="' + name + '"]').selective('get', { incomplete: true });
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    boolean: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      // Seems odd but sometimes used to mandate an "I agree" box
      if (field.required && !data[name]) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    checkboxes: function(data, name, $field, $el, field, callback) {
      var values = [];
      for (var c in field.choices) {
        var val = field.choices[c].value;
        var checked = $field.filter('[value="'+val+'"]').prop('checked');
        if (checked) {
          values.push(val);
        }
      }
      data[name] = values;
      if (field.required && !data[name]) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    select: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    integer: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    float: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    url: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    date: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
    },
    time: function(data, name, $field, $el, field, callback) {
      data[name] = $field.val();
      if (field.required && !data[name].length) {
        return apos.afterYield(_.partial(callback, 'required'));
      }
      return apos.afterYield(callback);
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
    array: function(data, name, $field, $el, field, callback) {
      var $fieldset = self.findFieldset($el, name);
      var $template = self.findSafe($fieldset, '.apos-template[data-element]');

      var $add = self.findSafe($fieldset, '[data-add]');
      var $elements = self.findSafe($fieldset, '[data-elements]');

      // Add the elements via an async for loop without
      // the async module. -Tom

      var i = 0;
      data = data[name] || [];
      function nextElement() {
        if (i === data.length) {
          $elements.sortable({ handle: '[data-move]' });
          return callback(null);
        }
        var $element = $template.clone();
        $element.removeClass('apos-template');
        addRemoveHandler($element);
        addMoveHandler($element);

        $elements.append($element);
        return self.populateFields($element, field.schema, data[i], function() {
          i++;
          return nextElement();
        });
      }
      nextElement();

      $add.on('click', function() {
        var $element = $template.clone();
        $element.removeClass('apos-template');
        $elements.prepend($element);
        addRemoveHandler($element);
        addMoveHandler($element);

        var element = {};
        _.each(field.schema, function(field) {
          if (field.def !== undefined) {
            element[field.name] = field.def;
          }
        });

        self.populateFields($element, field.schema, element, function() {
          // Make sure lister gets a crack
          apos.emit('enhance', $element);
        });
        return false;
      });

      function addRemoveHandler($element) {
        var $remove = self.findSafe($element, '[data-remove]');
        $remove.on('click', function() {
          $element.remove();
          return false;
        });
      }

      function addMoveHandler($element) {
        var $move = self.findSafe($element, '[data-move-item]');
        $move.on('click', function() {
          if ($(this).attr('data-move-item') === 'up') {
            $element.prev().before($element);
          } else {
            $element.next().after($element);
          }
          return false;
        });
      }

    },
    string: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    password: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    slug: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    tags: function(data, name, $field, $el, field, callback) {
      apos.enableTags(self.findSafe($el, '[data-name="' + name + '"]'), data[name]);
      return apos.afterYield(callback);
    },
    url: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    checkboxes: function(data, name, $field, $el, field, callback) {
      for(var c in data[name]) {
        $el.find('input[name="'+name+'"][value="'+data[name][c]+'"]').prop('checked', true);
      }
      return apos.afterYield(callback);
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
        // Always select the first item if no item is selected.
        // This is consistent with what most browsers do and works around
        // an issue with lister
        $field.val(((data[name] === undefined) && field.choices[0]) ? field.choices[0].value : data[name]);
      }
      return apos.afterYield(callback);
    },
    integer: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    float: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      return apos.afterYield(callback);
    },
    boolean: function(data, name, $field, $el, field, callback) {
      $field.val(data[name] ? '1' : '0');
      return apos.afterYield(callback);
    },
    joinByOne: function(data, name, $field, $el, field, callback) {
      // Since we can't use a regular name attribute for a div
      $field = self.findSafe($el, '[data-name="' + name + '"]');
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
      var autocomplete = '/apos-pages/autocomplete?type=' + field.withType;
      if (manager) {
        autocomplete = manager._action + '/autocomplete';
      }
      $field.selective({ limit: 1, data: selectiveData, source: autocomplete });

      self.enhanceSelectiveWithSlugs($field);
      return apos.afterYield(callback);
    },
    joinByOneReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on the reverse side
      return apos.afterYield(callback);
    },
    joinByArray: function(data, name, $field, $el, field, callback) {
      // Since we can't use a regular name attribute for a div
      $field = self.findSafe($el, '[data-name="' + name + '"]');
      if (!$field.length) {
        apos.log('Error: your new.html template for the ' + self.name + ' module does not have a snippetSelective call for the ' + name + ' join yet');
      }
      var selectiveData = [];

      // For now this is still correct on the browser side, getManager
      // always returns undefined for an index type
      var manager = aposPages.getManager(field.withType);
      var autocomplete = '/apos-pages/autocomplete?type=' + field.withType;
      if (manager) {
        autocomplete = manager._action + '/autocomplete';
      }

      // The server knows the title of the joined things, while we know
      // about our relationship properties. Solve the puzzle by
      // passing selective plain old IDs, causing it to call back to its
      // source for the corresponding labels. Provide a custom source
      // that queries the server and then merges in the relationship fields.
      if (field.relationshipField) {
        var url = autocomplete;
        autocomplete = function(req, callback) {
          $.getJSON(url, req, function(results) {
            // This gives us "label" and "value", add the
            // relationship info and invoke the original callback
            _.each(results, function(result) {
              var relationship = data[field.relationshipField][result.value];
              if (relationship) {
                _.extend(result, relationship);
                _.each(field.relationship, function(relField) {
                  if (relField.type === 'boolean') {
                    // Fix booleans to work as select elements expect
                    result[relField.name] = result[relField.name] ? '1' : '0';
                  }
                });
              }
            });
            return callback(results);
          });
        };
      }

      $field.selective({ preventDuplicates: true, sortable: field.sortable, extras: !!field.relationship, data: data[field.idsField] || [], source: autocomplete });
      self.enhanceSelectiveWithSlugs($field);
      return apos.afterYield(callback);
    },
    joinByArrayReverse: function(data, name, $field, $el, field, callback) {
      // Not edited on the reverse side
      return apos.afterYield(callback);
    },
    group: function(data, name, $field, $el, field, callback) {
      // Just a presentation thing
      return apos.afterYield(callback);
    },
    date: function(data, name, $field, $el, field, callback) {
      $field.val(data[name]);
      apos.enhanceDate($field);
      if (field.legacy) {
        apos.enhanceDate(self.findField($el, field.legacy));
      }
      return apos.afterYield(callback);
    },
    time: function(data, name, $field, $el, field, callback) {
      if (data[name] && data[name].length) {
        // Revert to local time for editing
        $field.val(apos.formatTime(data[name]));
      }
      return apos.afterYield(callback);
    },
  };

  self.addFieldType = function(type) {
    self.displayers[type.name] = type.displayer;
    self.converters[type.name] = type.converter;
  };

  // A convenience method for calling attention to errors in fields in your own
  // independent validation code.

  self.addError = function($el, name) {
    self.findSafe($el, '[data-name="' + name + '"]').addClass('apos-error');
  };

  // A convenience allowing you to scroll to the first error present,
  // if any. Not called automatically. You can call this when
  // convertFields passes an error or when your own validation code
  // has invoked addError().

  self.scrollToError = function($el) {
    var $element = self.findSafe($el, '.apos-error');
    if (!$element.length) {
      return;
    }
    var offset = $element.offset();
    var scrollTop = offset.top - 100;
    $('html, body').scrollTop(scrollTop);
    $element.find('input,select,textarea').first().focus();
  };

  // Used to search for fieldsets at this level of the schema,
  // without false positives for any schemas nested within it
  self.findFieldset = function($el, name) {
    return self.findSafe($el, '[data-name="' + name + '"]');
  };

  // Used to search for elements without false positives from nested
  // schemas in unrelated fieldsets
  self.findSafe = function($el, sel) {
    return $el.find(sel).filter(function() {
      var $parents = $(this).parents();
      var i;
      for (i = 0; (i < $parents.length); i++) {
        if ($parents[i] === $el[0]) {
          return true;
        }
        if ($($parents[i]).hasClass('apos-fieldset')) {
          return false;
        }
      }
    });
  };

  // Used to search for simple elements that have a
  // "name" attribute, without false positives from nested
  // schemas in unrelated fieldsets.
  self.findField = function($el, name) {
    $fieldset = self.findFieldset($el, name);
    return self.findSafe($fieldset, '[name="' + name + '"]');
  };

  self.enhanceSelectiveWithSlugs = function($field) {
    // Change the presentation to include the slug.
    // Based on: http://jqueryui.com/autocomplete/#custom-data
    // I stuck with that markup with a minimum of new markup to
    // allow styling. -Tom
    var $autocomplete = self.findSafe($field, "[data-autocomplete]");
    $autocomplete.data( "ui-autocomplete" )._renderItem = function(ul, item) {
      var inner = '<a><div class="apos-autocomplete-label">' + item.label + '</div>';
      if (item.slug) {
        inner += '<div class="apos-autocomplete-slug">' + item.slug + '</div>';
      }
      inner += '</a>';
      return $('<li class="apos-autocomplete-item">')
        .append(inner)
        .appendTo(ul);
    };
  };
}

// Instantiate the singleton
var aposSchemas = new AposSchemas();
