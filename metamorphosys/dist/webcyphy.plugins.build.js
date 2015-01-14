var WebGMEGlobal = WebGMEGlobal || {}; WebGMEGlobal.plugins = WebGMEGlobal.plugins || {};(function(){/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.11 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.11',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part, length = ary.length;
            for (i = 0; i < length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = name.split('/');
                    lastIndex = name.length - 1;

                    // If wanting node ID compatibility, strip .js from end
                    // of IDs. Have to do this here, and not in nameToUrl
                    // because node allows either .js or non .js to map
                    // to same file.
                    if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                        name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                    }

                    name = normalizedBaseParts.concat(name);
                    trimDots(name);
                    name = name.join('/');
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return  getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if(args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define("node_modules/requirejs/require", function(){});

// wrapper for non-node envs
define ('sax',[], function () {
    var sax = {};
    sax.parser = function (strict, opt) { return new SAXParser(strict, opt) }
    sax.SAXParser = SAXParser
    sax.SAXStream = SAXStream
    sax.createStream = createStream

// When we pass the MAX_BUFFER_LENGTH position, start checking for buffer overruns.
// When we check, schedule the next check for MAX_BUFFER_LENGTH - (max(buffer lengths)),
// since that's the earliest that a buffer overrun could occur.  This way, checks are
// as rare as required, but as often as necessary to ensure never crossing this bound.
// Furthermore, buffers are only tested at most once per write(), so passing a very
// large string into write() might have undesirable effects, but this is manageable by
// the caller, so it is assumed to be safe.  Thus, a call to write() may, in the extreme
// edge case, result in creating at most one complete copy of the string passed in.
// Set to Infinity to have unlimited buffers.
    sax.MAX_BUFFER_LENGTH = 64 * 1024

    var buffers = [
        "comment", "sgmlDecl", "textNode", "tagName", "doctype",
        "procInstName", "procInstBody", "entity", "attribName",
        "attribValue", "cdata", "script"
    ]

    sax.EVENTS = // for discoverability.
        [ "text"
            , "processinginstruction"
            , "sgmldeclaration"
            , "doctype"
            , "comment"
            , "attribute"
            , "opentag"
            , "closetag"
            , "opencdata"
            , "cdata"
            , "closecdata"
            , "error"
            , "end"
            , "ready"
            , "script"
            , "opennamespace"
            , "closenamespace"
        ]

    function SAXParser (strict, opt) {
        if (!(this instanceof SAXParser)) return new SAXParser(strict, opt)

        var parser = this
        clearBuffers(parser)
        parser.q = parser.c = ""
        parser.bufferCheckPosition = sax.MAX_BUFFER_LENGTH
        parser.opt = opt || {}
        parser.opt.lowercase = parser.opt.lowercase || parser.opt.lowercasetags
        parser.looseCase = parser.opt.lowercase ? "toLowerCase" : "toUpperCase"
        parser.tags = []
        parser.closed = parser.closedRoot = parser.sawRoot = false
        parser.tag = parser.error = null
        parser.strict = !!strict
        parser.noscript = !!(strict || parser.opt.noscript)
        parser.state = S.BEGIN
        parser.ENTITIES = Object.create(sax.ENTITIES)
        parser.attribList = []

        // namespaces form a prototype chain.
        // it always points at the current tag,
        // which protos to its parent tag.
        if (parser.opt.xmlns) parser.ns = Object.create(rootNS)

        // mostly just for error reporting
        parser.trackPosition = parser.opt.position !== false
        if (parser.trackPosition) {
            parser.position = parser.line = parser.column = 0
        }
        emit(parser, "onready")
    }

    if (!Object.create) Object.create = function (o) {
        function f () { this.__proto__ = o }
        f.prototype = o
        return new f
    }

    if (!Object.getPrototypeOf) Object.getPrototypeOf = function (o) {
        return o.__proto__
    }

    if (!Object.keys) Object.keys = function (o) {
        var a = []
        for (var i in o) if (o.hasOwnProperty(i)) a.push(i)
        return a
    }

    function checkBufferLength (parser) {
        var maxAllowed = Math.max(sax.MAX_BUFFER_LENGTH, 10)
            , maxActual = 0
        for (var i = 0, l = buffers.length; i < l; i ++) {
            var len = parser[buffers[i]].length
            if (len > maxAllowed) {
                // Text/cdata nodes can get big, and since they're buffered,
                // we can get here under normal conditions.
                // Avoid issues by emitting the text node now,
                // so at least it won't get any bigger.
                switch (buffers[i]) {
                    case "textNode":
                        closeText(parser)
                        break

                    case "cdata":
                        emitNode(parser, "oncdata", parser.cdata)
                        parser.cdata = ""
                        break

                    case "script":
                        emitNode(parser, "onscript", parser.script)
                        parser.script = ""
                        break

                    default:
                        error(parser, "Max buffer length exceeded: "+buffers[i])
                }
            }
            maxActual = Math.max(maxActual, len)
        }
        // schedule the next check for the earliest possible buffer overrun.
        parser.bufferCheckPosition = (sax.MAX_BUFFER_LENGTH - maxActual)
            + parser.position
    }

    function clearBuffers (parser) {
        for (var i = 0, l = buffers.length; i < l; i ++) {
            parser[buffers[i]] = ""
        }
    }

    function flushBuffers (parser) {
        closeText(parser)
        if (parser.cdata !== "") {
            emitNode(parser, "oncdata", parser.cdata)
            parser.cdata = ""
        }
        if (parser.script !== "") {
            emitNode(parser, "onscript", parser.script)
            parser.script = ""
        }
    }

    SAXParser.prototype =
    { end: function () { end(this) }
        , write: write
        , resume: function () { this.error = null; return this }
        , close: function () { return this.write(null) }
        , flush: function () { flushBuffers(this) }
    }

    try {
        var Stream = require("stream").Stream
    } catch (ex) {
        var Stream = function () {}
    }


    var streamWraps = sax.EVENTS.filter(function (ev) {
        return ev !== "error" && ev !== "end"
    })

    function createStream (strict, opt) {
        return new SAXStream(strict, opt)
    }

    function SAXStream (strict, opt) {
        if (!(this instanceof SAXStream)) return new SAXStream(strict, opt)

        Stream.apply(this)

        this._parser = new SAXParser(strict, opt)
        this.writable = true
        this.readable = true


        var me = this

        this._parser.onend = function () {
            me.emit("end")
        }

        this._parser.onerror = function (er) {
            me.emit("error", er)

            // if didn't throw, then means error was handled.
            // go ahead and clear error, so we can write again.
            me._parser.error = null
        }

        this._decoder = null;

        streamWraps.forEach(function (ev) {
            Object.defineProperty(me, "on" + ev, {
                get: function () { return me._parser["on" + ev] },
                set: function (h) {
                    if (!h) {
                        me.removeAllListeners(ev)
                        return me._parser["on"+ev] = h
                    }
                    me.on(ev, h)
                },
                enumerable: true,
                configurable: false
            })
        })
    }

    SAXStream.prototype = Object.create(Stream.prototype,
        { constructor: { value: SAXStream } })

    SAXStream.prototype.write = function (data) {
        if (typeof Buffer === 'function' &&
            typeof Buffer.isBuffer === 'function' &&
            Buffer.isBuffer(data)) {
            if (!this._decoder) {
                var SD = require('string_decoder').StringDecoder
                this._decoder = new SD('utf8')
            }
            data = this._decoder.write(data);
        }

        this._parser.write(data.toString())
        this.emit("data", data)
        return true
    }

    SAXStream.prototype.end = function (chunk) {
        if (chunk && chunk.length) this.write(chunk)
        this._parser.end()
        return true
    }

    SAXStream.prototype.on = function (ev, handler) {
        var me = this
        if (!me._parser["on"+ev] && streamWraps.indexOf(ev) !== -1) {
            me._parser["on"+ev] = function () {
                var args = arguments.length === 1 ? [arguments[0]]
                    : Array.apply(null, arguments)
                args.splice(0, 0, ev)
                me.emit.apply(me, args)
            }
        }

        return Stream.prototype.on.call(me, ev, handler)
    }



// character classes and tokens
    var whitespace = "\r\n\t "
    // this really needs to be replaced with character classes.
    // XML allows all manner of ridiculous numbers and digits.
        , number = "0124356789"
        , letter = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    // (Letter | "_" | ":")
        , quote = "'\""
        , entity = number+letter+"#"
        , attribEnd = whitespace + ">"
        , CDATA = "[CDATA["
        , DOCTYPE = "DOCTYPE"
        , XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace"
        , XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/"
        , rootNS = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE }

// turn all the string character sets into character class objects.
    whitespace = charClass(whitespace)
    number = charClass(number)
    letter = charClass(letter)

// http://www.w3.org/TR/REC-xml/#NT-NameStartChar
// This implementation works on strings, a single character at a time
// as such, it cannot ever support astral-plane characters (10000-EFFFF)
// without a significant breaking change to either this  parser, or the
// JavaScript language.  Implementation of an emoji-capable xml parser
// is left as an exercise for the reader.
    var nameStart = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/

    var nameBody = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040\.\d-]/

    quote = charClass(quote)
    entity = charClass(entity)
    attribEnd = charClass(attribEnd)

    function charClass (str) {
        return str.split("").reduce(function (s, c) {
            s[c] = true
            return s
        }, {})
    }

    function isRegExp (c) {
        return Object.prototype.toString.call(c) === '[object RegExp]'
    }

    function is (charclass, c) {
        return isRegExp(charclass) ? !!c.match(charclass) : charclass[c]
    }

    function not (charclass, c) {
        return !is(charclass, c)
    }

    var S = 0
    sax.STATE =
    { BEGIN                     : S++
        , TEXT                      : S++ // general stuff
        , TEXT_ENTITY               : S++ // &amp and such.
        , OPEN_WAKA                 : S++ // <
        , SGML_DECL                 : S++ // <!BLARG
        , SGML_DECL_QUOTED          : S++ // <!BLARG foo "bar
        , DOCTYPE                   : S++ // <!DOCTYPE
        , DOCTYPE_QUOTED            : S++ // <!DOCTYPE "//blah
        , DOCTYPE_DTD               : S++ // <!DOCTYPE "//blah" [ ...
        , DOCTYPE_DTD_QUOTED        : S++ // <!DOCTYPE "//blah" [ "foo
        , COMMENT_STARTING          : S++ // <!-
        , COMMENT                   : S++ // <!--
        , COMMENT_ENDING            : S++ // <!-- blah -
        , COMMENT_ENDED             : S++ // <!-- blah --
        , CDATA                     : S++ // <![CDATA[ something
        , CDATA_ENDING              : S++ // ]
        , CDATA_ENDING_2            : S++ // ]]
        , PROC_INST                 : S++ // <?hi
        , PROC_INST_BODY            : S++ // <?hi there
        , PROC_INST_ENDING          : S++ // <?hi "there" ?
        , OPEN_TAG                  : S++ // <strong
        , OPEN_TAG_SLASH            : S++ // <strong /
        , ATTRIB                    : S++ // <a
        , ATTRIB_NAME               : S++ // <a foo
        , ATTRIB_NAME_SAW_WHITE     : S++ // <a foo _
        , ATTRIB_VALUE              : S++ // <a foo=
        , ATTRIB_VALUE_QUOTED       : S++ // <a foo="bar
        , ATTRIB_VALUE_CLOSED       : S++ // <a foo="bar"
        , ATTRIB_VALUE_UNQUOTED     : S++ // <a foo=bar
        , ATTRIB_VALUE_ENTITY_Q     : S++ // <foo bar="&quot;"
        , ATTRIB_VALUE_ENTITY_U     : S++ // <foo bar=&quot;
        , CLOSE_TAG                 : S++ // </a
        , CLOSE_TAG_SAW_WHITE       : S++ // </a   >
        , SCRIPT                    : S++ // <script> ...
        , SCRIPT_ENDING             : S++ // <script> ... <
    }

    sax.ENTITIES =
    { "amp" : "&"
        , "gt" : ">"
        , "lt" : "<"
        , "quot" : "\""
        , "apos" : "'"
        , "AElig" : 198
        , "Aacute" : 193
        , "Acirc" : 194
        , "Agrave" : 192
        , "Aring" : 197
        , "Atilde" : 195
        , "Auml" : 196
        , "Ccedil" : 199
        , "ETH" : 208
        , "Eacute" : 201
        , "Ecirc" : 202
        , "Egrave" : 200
        , "Euml" : 203
        , "Iacute" : 205
        , "Icirc" : 206
        , "Igrave" : 204
        , "Iuml" : 207
        , "Ntilde" : 209
        , "Oacute" : 211
        , "Ocirc" : 212
        , "Ograve" : 210
        , "Oslash" : 216
        , "Otilde" : 213
        , "Ouml" : 214
        , "THORN" : 222
        , "Uacute" : 218
        , "Ucirc" : 219
        , "Ugrave" : 217
        , "Uuml" : 220
        , "Yacute" : 221
        , "aacute" : 225
        , "acirc" : 226
        , "aelig" : 230
        , "agrave" : 224
        , "aring" : 229
        , "atilde" : 227
        , "auml" : 228
        , "ccedil" : 231
        , "eacute" : 233
        , "ecirc" : 234
        , "egrave" : 232
        , "eth" : 240
        , "euml" : 235
        , "iacute" : 237
        , "icirc" : 238
        , "igrave" : 236
        , "iuml" : 239
        , "ntilde" : 241
        , "oacute" : 243
        , "ocirc" : 244
        , "ograve" : 242
        , "oslash" : 248
        , "otilde" : 245
        , "ouml" : 246
        , "szlig" : 223
        , "thorn" : 254
        , "uacute" : 250
        , "ucirc" : 251
        , "ugrave" : 249
        , "uuml" : 252
        , "yacute" : 253
        , "yuml" : 255
        , "copy" : 169
        , "reg" : 174
        , "nbsp" : 160
        , "iexcl" : 161
        , "cent" : 162
        , "pound" : 163
        , "curren" : 164
        , "yen" : 165
        , "brvbar" : 166
        , "sect" : 167
        , "uml" : 168
        , "ordf" : 170
        , "laquo" : 171
        , "not" : 172
        , "shy" : 173
        , "macr" : 175
        , "deg" : 176
        , "plusmn" : 177
        , "sup1" : 185
        , "sup2" : 178
        , "sup3" : 179
        , "acute" : 180
        , "micro" : 181
        , "para" : 182
        , "middot" : 183
        , "cedil" : 184
        , "ordm" : 186
        , "raquo" : 187
        , "frac14" : 188
        , "frac12" : 189
        , "frac34" : 190
        , "iquest" : 191
        , "times" : 215
        , "divide" : 247
        , "OElig" : 338
        , "oelig" : 339
        , "Scaron" : 352
        , "scaron" : 353
        , "Yuml" : 376
        , "fnof" : 402
        , "circ" : 710
        , "tilde" : 732
        , "Alpha" : 913
        , "Beta" : 914
        , "Gamma" : 915
        , "Delta" : 916
        , "Epsilon" : 917
        , "Zeta" : 918
        , "Eta" : 919
        , "Theta" : 920
        , "Iota" : 921
        , "Kappa" : 922
        , "Lambda" : 923
        , "Mu" : 924
        , "Nu" : 925
        , "Xi" : 926
        , "Omicron" : 927
        , "Pi" : 928
        , "Rho" : 929
        , "Sigma" : 931
        , "Tau" : 932
        , "Upsilon" : 933
        , "Phi" : 934
        , "Chi" : 935
        , "Psi" : 936
        , "Omega" : 937
        , "alpha" : 945
        , "beta" : 946
        , "gamma" : 947
        , "delta" : 948
        , "epsilon" : 949
        , "zeta" : 950
        , "eta" : 951
        , "theta" : 952
        , "iota" : 953
        , "kappa" : 954
        , "lambda" : 955
        , "mu" : 956
        , "nu" : 957
        , "xi" : 958
        , "omicron" : 959
        , "pi" : 960
        , "rho" : 961
        , "sigmaf" : 962
        , "sigma" : 963
        , "tau" : 964
        , "upsilon" : 965
        , "phi" : 966
        , "chi" : 967
        , "psi" : 968
        , "omega" : 969
        , "thetasym" : 977
        , "upsih" : 978
        , "piv" : 982
        , "ensp" : 8194
        , "emsp" : 8195
        , "thinsp" : 8201
        , "zwnj" : 8204
        , "zwj" : 8205
        , "lrm" : 8206
        , "rlm" : 8207
        , "ndash" : 8211
        , "mdash" : 8212
        , "lsquo" : 8216
        , "rsquo" : 8217
        , "sbquo" : 8218
        , "ldquo" : 8220
        , "rdquo" : 8221
        , "bdquo" : 8222
        , "dagger" : 8224
        , "Dagger" : 8225
        , "bull" : 8226
        , "hellip" : 8230
        , "permil" : 8240
        , "prime" : 8242
        , "Prime" : 8243
        , "lsaquo" : 8249
        , "rsaquo" : 8250
        , "oline" : 8254
        , "frasl" : 8260
        , "euro" : 8364
        , "image" : 8465
        , "weierp" : 8472
        , "real" : 8476
        , "trade" : 8482
        , "alefsym" : 8501
        , "larr" : 8592
        , "uarr" : 8593
        , "rarr" : 8594
        , "darr" : 8595
        , "harr" : 8596
        , "crarr" : 8629
        , "lArr" : 8656
        , "uArr" : 8657
        , "rArr" : 8658
        , "dArr" : 8659
        , "hArr" : 8660
        , "forall" : 8704
        , "part" : 8706
        , "exist" : 8707
        , "empty" : 8709
        , "nabla" : 8711
        , "isin" : 8712
        , "notin" : 8713
        , "ni" : 8715
        , "prod" : 8719
        , "sum" : 8721
        , "minus" : 8722
        , "lowast" : 8727
        , "radic" : 8730
        , "prop" : 8733
        , "infin" : 8734
        , "ang" : 8736
        , "and" : 8743
        , "or" : 8744
        , "cap" : 8745
        , "cup" : 8746
        , "int" : 8747
        , "there4" : 8756
        , "sim" : 8764
        , "cong" : 8773
        , "asymp" : 8776
        , "ne" : 8800
        , "equiv" : 8801
        , "le" : 8804
        , "ge" : 8805
        , "sub" : 8834
        , "sup" : 8835
        , "nsub" : 8836
        , "sube" : 8838
        , "supe" : 8839
        , "oplus" : 8853
        , "otimes" : 8855
        , "perp" : 8869
        , "sdot" : 8901
        , "lceil" : 8968
        , "rceil" : 8969
        , "lfloor" : 8970
        , "rfloor" : 8971
        , "lang" : 9001
        , "rang" : 9002
        , "loz" : 9674
        , "spades" : 9824
        , "clubs" : 9827
        , "hearts" : 9829
        , "diams" : 9830
    }

    Object.keys(sax.ENTITIES).forEach(function (key) {
        var e = sax.ENTITIES[key]
        var s = typeof e === 'number' ? String.fromCharCode(e) : e
        sax.ENTITIES[key] = s
    })

    for (var S in sax.STATE) sax.STATE[sax.STATE[S]] = S

// shorthand
    S = sax.STATE

    function emit (parser, event, data) {
        parser[event] && parser[event](data)
    }

    function emitNode (parser, nodeType, data) {
        if (parser.textNode) closeText(parser)
        emit(parser, nodeType, data)
    }

    function closeText (parser) {
        parser.textNode = textopts(parser.opt, parser.textNode)
        if (parser.textNode) emit(parser, "ontext", parser.textNode)
        parser.textNode = ""
    }

    function textopts (opt, text) {
        if (opt.trim) text = text.trim()
        if (opt.normalize) text = text.replace(/\s+/g, " ")
        return text
    }

    function error (parser, er) {
        closeText(parser)
        if (parser.trackPosition) {
            er += "\nLine: "+parser.line+
                "\nColumn: "+parser.column+
                "\nChar: "+parser.c
        }
        er = new Error(er)
        parser.error = er
        emit(parser, "onerror", er)
        return parser
    }

    function end (parser) {
        if (!parser.closedRoot) strictFail(parser, "Unclosed root tag")
        if ((parser.state !== S.BEGIN) && (parser.state !== S.TEXT)) error(parser, "Unexpected end")
        closeText(parser)
        parser.c = ""
        parser.closed = true
        emit(parser, "onend")
        SAXParser.call(parser, parser.strict, parser.opt)
        return parser
    }

    function strictFail (parser, message) {
        if (typeof parser !== 'object' || !(parser instanceof SAXParser))
            throw new Error('bad call to strictFail');
        if (parser.strict) error(parser, message)
    }

    function newTag (parser) {
        if (!parser.strict) parser.tagName = parser.tagName[parser.looseCase]()
        var parent = parser.tags[parser.tags.length - 1] || parser
            , tag = parser.tag = { name : parser.tagName, attributes : {} }

        // will be overridden if tag contails an xmlns="foo" or xmlns:foo="bar"
        if (parser.opt.xmlns) tag.ns = parent.ns
        parser.attribList.length = 0
    }

    function qname (name, attribute) {
        var i = name.indexOf(":")
            , qualName = i < 0 ? [ "", name ] : name.split(":")
            , prefix = qualName[0]
            , local = qualName[1]

        // <x "xmlns"="http://foo">
        if (attribute && name === "xmlns") {
            prefix = "xmlns"
            local = ""
        }

        return { prefix: prefix, local: local }
    }

    function attrib (parser) {
        if (!parser.strict) parser.attribName = parser.attribName[parser.looseCase]()

        if (parser.attribList.indexOf(parser.attribName) !== -1 ||
            parser.tag.attributes.hasOwnProperty(parser.attribName)) {
            return parser.attribName = parser.attribValue = ""
        }

        if (parser.opt.xmlns) {
            var qn = qname(parser.attribName, true)
                , prefix = qn.prefix
                , local = qn.local

            if (prefix === "xmlns") {
                // namespace binding attribute; push the binding into scope
                if (local === "xml" && parser.attribValue !== XML_NAMESPACE) {
                    strictFail( parser
                        , "xml: prefix must be bound to " + XML_NAMESPACE + "\n"
                            + "Actual: " + parser.attribValue )
                } else if (local === "xmlns" && parser.attribValue !== XMLNS_NAMESPACE) {
                    strictFail( parser
                        , "xmlns: prefix must be bound to " + XMLNS_NAMESPACE + "\n"
                            + "Actual: " + parser.attribValue )
                } else {
                    var tag = parser.tag
                        , parent = parser.tags[parser.tags.length - 1] || parser
                    if (tag.ns === parent.ns) {
                        tag.ns = Object.create(parent.ns)
                    }
                    tag.ns[local] = parser.attribValue
                }
            }

            // defer onattribute events until all attributes have been seen
            // so any new bindings can take effect; preserve attribute order
            // so deferred events can be emitted in document order
            parser.attribList.push([parser.attribName, parser.attribValue])
        } else {
            // in non-xmlns mode, we can emit the event right away
            parser.tag.attributes[parser.attribName] = parser.attribValue
            emitNode( parser
                , "onattribute"
                , { name: parser.attribName
                    , value: parser.attribValue } )
        }

        parser.attribName = parser.attribValue = ""
    }

    function openTag (parser, selfClosing) {
        if (parser.opt.xmlns) {
            // emit namespace binding events
            var tag = parser.tag

            // add namespace info to tag
            var qn = qname(parser.tagName)
            tag.prefix = qn.prefix
            tag.local = qn.local
            tag.uri = tag.ns[qn.prefix] || ""

            if (tag.prefix && !tag.uri) {
                strictFail(parser, "Unbound namespace prefix: "
                    + JSON.stringify(parser.tagName))
                tag.uri = qn.prefix
            }

            var parent = parser.tags[parser.tags.length - 1] || parser
            if (tag.ns && parent.ns !== tag.ns) {
                Object.keys(tag.ns).forEach(function (p) {
                    emitNode( parser
                        , "onopennamespace"
                        , { prefix: p , uri: tag.ns[p] } )
                })
            }

            // handle deferred onattribute events
            // Note: do not apply default ns to attributes:
            //   http://www.w3.org/TR/REC-xml-names/#defaulting
            for (var i = 0, l = parser.attribList.length; i < l; i ++) {
                var nv = parser.attribList[i]
                var name = nv[0]
                    , value = nv[1]
                    , qualName = qname(name, true)
                    , prefix = qualName.prefix
                    , local = qualName.local
                    , uri = prefix == "" ? "" : (tag.ns[prefix] || "")
                    , a = { name: name
                        , value: value
                        , prefix: prefix
                        , local: local
                        , uri: uri
                    }

                // if there's any attributes with an undefined namespace,
                // then fail on them now.
                if (prefix && prefix != "xmlns" && !uri) {
                    strictFail(parser, "Unbound namespace prefix: "
                        + JSON.stringify(prefix))
                    a.uri = prefix
                }
                parser.tag.attributes[name] = a
                emitNode(parser, "onattribute", a)
            }
            parser.attribList.length = 0
        }

        parser.tag.isSelfClosing = !!selfClosing

        // process the tag
        parser.sawRoot = true
        parser.tags.push(parser.tag)
        emitNode(parser, "onopentag", parser.tag)
        if (!selfClosing) {
            // special case for <script> in non-strict mode.
            if (!parser.noscript && parser.tagName.toLowerCase() === "script") {
                parser.state = S.SCRIPT
            } else {
                parser.state = S.TEXT
            }
            parser.tag = null
            parser.tagName = ""
        }
        parser.attribName = parser.attribValue = ""
        parser.attribList.length = 0
    }

    function closeTag (parser) {
        if (!parser.tagName) {
            strictFail(parser, "Weird empty close tag.")
            parser.textNode += "</>"
            parser.state = S.TEXT
            return
        }

        if (parser.script) {
            if (parser.tagName !== "script") {
                parser.script += "</" + parser.tagName + ">"
                parser.tagName = ""
                parser.state = S.SCRIPT
                return
            }
            emitNode(parser, "onscript", parser.script)
            parser.script = ""
        }

        // first make sure that the closing tag actually exists.
        // <a><b></c></b></a> will close everything, otherwise.
        var t = parser.tags.length
        var tagName = parser.tagName
        if (!parser.strict) tagName = tagName[parser.looseCase]()
        var closeTo = tagName
        while (t --) {
            var close = parser.tags[t]
            if (close.name !== closeTo) {
                // fail the first time in strict mode
                strictFail(parser, "Unexpected close tag")
            } else break
        }

        // didn't find it.  we already failed for strict, so just abort.
        if (t < 0) {
            strictFail(parser, "Unmatched closing tag: "+parser.tagName)
            parser.textNode += "</" + parser.tagName + ">"
            parser.state = S.TEXT
            return
        }
        parser.tagName = tagName
        var s = parser.tags.length
        while (s --> t) {
            var tag = parser.tag = parser.tags.pop()
            parser.tagName = parser.tag.name
            emitNode(parser, "onclosetag", parser.tagName)

            var x = {}
            for (var i in tag.ns) x[i] = tag.ns[i]

            var parent = parser.tags[parser.tags.length - 1] || parser
            if (parser.opt.xmlns && tag.ns !== parent.ns) {
                // remove namespace bindings introduced by tag
                Object.keys(tag.ns).forEach(function (p) {
                    var n = tag.ns[p]
                    emitNode(parser, "onclosenamespace", { prefix: p, uri: n })
                })
            }
        }
        if (t === 0) parser.closedRoot = true
        parser.tagName = parser.attribValue = parser.attribName = ""
        parser.attribList.length = 0
        parser.state = S.TEXT
    }

    function parseEntity (parser) {
        var entity = parser.entity
            , entityLC = entity.toLowerCase()
            , num
            , numStr = ""
        if (parser.ENTITIES[entity])
            return parser.ENTITIES[entity]
        if (parser.ENTITIES[entityLC])
            return parser.ENTITIES[entityLC]
        entity = entityLC
        if (entity.charAt(0) === "#") {
            if (entity.charAt(1) === "x") {
                entity = entity.slice(2)
                num = parseInt(entity, 16)
                numStr = num.toString(16)
            } else {
                entity = entity.slice(1)
                num = parseInt(entity, 10)
                numStr = num.toString(10)
            }
        }
        entity = entity.replace(/^0+/, "")
        if (numStr.toLowerCase() !== entity) {
            strictFail(parser, "Invalid character entity")
            return "&"+parser.entity + ";"
        }

        return String.fromCodePoint(num)
    }

    function write (chunk) {
        var parser = this
        if (this.error) throw this.error
        if (parser.closed) return error(parser,
            "Cannot write after close. Assign an onready handler.")
        if (chunk === null) return end(parser)
        var i = 0, c = ""
        while (parser.c = c = chunk.charAt(i++)) {
            if (parser.trackPosition) {
                parser.position ++
                if (c === "\n") {
                    parser.line ++
                    parser.column = 0
                } else parser.column ++
            }
            switch (parser.state) {

                case S.BEGIN:
                    if (c === "<") {
                        parser.state = S.OPEN_WAKA
                        parser.startTagPosition = parser.position
                    } else if (not(whitespace,c)) {
                        // have to process this as a text node.
                        // weird, but happens.
                        strictFail(parser, "Non-whitespace before first tag.")
                        parser.textNode = c
                        parser.state = S.TEXT
                    }
                    continue

                case S.TEXT:
                    if (parser.sawRoot && !parser.closedRoot) {
                        var starti = i-1
                        while (c && c!=="<" && c!=="&") {
                            c = chunk.charAt(i++)
                            if (c && parser.trackPosition) {
                                parser.position ++
                                if (c === "\n") {
                                    parser.line ++
                                    parser.column = 0
                                } else parser.column ++
                            }
                        }
                        parser.textNode += chunk.substring(starti, i-1)
                    }
                    if (c === "<") {
                        parser.state = S.OPEN_WAKA
                        parser.startTagPosition = parser.position
                    } else {
                        if (not(whitespace, c) && (!parser.sawRoot || parser.closedRoot))
                            strictFail(parser, "Text data outside of root node.")
                        if (c === "&") parser.state = S.TEXT_ENTITY
                        else parser.textNode += c
                    }
                    continue

                case S.SCRIPT:
                    // only non-strict
                    if (c === "<") {
                        parser.state = S.SCRIPT_ENDING
                    } else parser.script += c
                    continue

                case S.SCRIPT_ENDING:
                    if (c === "/") {
                        parser.state = S.CLOSE_TAG
                    } else {
                        parser.script += "<" + c
                        parser.state = S.SCRIPT
                    }
                    continue

                case S.OPEN_WAKA:
                    // either a /, ?, !, or text is coming next.
                    if (c === "!") {
                        parser.state = S.SGML_DECL
                        parser.sgmlDecl = ""
                    } else if (is(whitespace, c)) {
                        // wait for it...
                    } else if (is(nameStart,c)) {
                        parser.state = S.OPEN_TAG
                        parser.tagName = c
                    } else if (c === "/") {
                        parser.state = S.CLOSE_TAG
                        parser.tagName = ""
                    } else if (c === "?") {
                        parser.state = S.PROC_INST
                        parser.procInstName = parser.procInstBody = ""
                    } else {
                        strictFail(parser, "Unencoded <")
                        // if there was some whitespace, then add that in.
                        if (parser.startTagPosition + 1 < parser.position) {
                            var pad = parser.position - parser.startTagPosition
                            c = new Array(pad).join(" ") + c
                        }
                        parser.textNode += "<" + c
                        parser.state = S.TEXT
                    }
                    continue

                case S.SGML_DECL:
                    if ((parser.sgmlDecl+c).toUpperCase() === CDATA) {
                        emitNode(parser, "onopencdata")
                        parser.state = S.CDATA
                        parser.sgmlDecl = ""
                        parser.cdata = ""
                    } else if (parser.sgmlDecl+c === "--") {
                        parser.state = S.COMMENT
                        parser.comment = ""
                        parser.sgmlDecl = ""
                    } else if ((parser.sgmlDecl+c).toUpperCase() === DOCTYPE) {
                        parser.state = S.DOCTYPE
                        if (parser.doctype || parser.sawRoot) strictFail(parser,
                            "Inappropriately located doctype declaration")
                        parser.doctype = ""
                        parser.sgmlDecl = ""
                    } else if (c === ">") {
                        emitNode(parser, "onsgmldeclaration", parser.sgmlDecl)
                        parser.sgmlDecl = ""
                        parser.state = S.TEXT
                    } else if (is(quote, c)) {
                        parser.state = S.SGML_DECL_QUOTED
                        parser.sgmlDecl += c
                    } else parser.sgmlDecl += c
                    continue

                case S.SGML_DECL_QUOTED:
                    if (c === parser.q) {
                        parser.state = S.SGML_DECL
                        parser.q = ""
                    }
                    parser.sgmlDecl += c
                    continue

                case S.DOCTYPE:
                    if (c === ">") {
                        parser.state = S.TEXT
                        emitNode(parser, "ondoctype", parser.doctype)
                        parser.doctype = true // just remember that we saw it.
                    } else {
                        parser.doctype += c
                        if (c === "[") parser.state = S.DOCTYPE_DTD
                        else if (is(quote, c)) {
                            parser.state = S.DOCTYPE_QUOTED
                            parser.q = c
                        }
                    }
                    continue

                case S.DOCTYPE_QUOTED:
                    parser.doctype += c
                    if (c === parser.q) {
                        parser.q = ""
                        parser.state = S.DOCTYPE
                    }
                    continue

                case S.DOCTYPE_DTD:
                    parser.doctype += c
                    if (c === "]") parser.state = S.DOCTYPE
                    else if (is(quote,c)) {
                        parser.state = S.DOCTYPE_DTD_QUOTED
                        parser.q = c
                    }
                    continue

                case S.DOCTYPE_DTD_QUOTED:
                    parser.doctype += c
                    if (c === parser.q) {
                        parser.state = S.DOCTYPE_DTD
                        parser.q = ""
                    }
                    continue

                case S.COMMENT:
                    if (c === "-") parser.state = S.COMMENT_ENDING
                    else parser.comment += c
                    continue

                case S.COMMENT_ENDING:
                    if (c === "-") {
                        parser.state = S.COMMENT_ENDED
                        parser.comment = textopts(parser.opt, parser.comment)
                        if (parser.comment) emitNode(parser, "oncomment", parser.comment)
                        parser.comment = ""
                    } else {
                        parser.comment += "-" + c
                        parser.state = S.COMMENT
                    }
                    continue

                case S.COMMENT_ENDED:
                    if (c !== ">") {
                        strictFail(parser, "Malformed comment")
                        // allow <!-- blah -- bloo --> in non-strict mode,
                        // which is a comment of " blah -- bloo "
                        parser.comment += "--" + c
                        parser.state = S.COMMENT
                    } else parser.state = S.TEXT
                    continue

                case S.CDATA:
                    if (c === "]") parser.state = S.CDATA_ENDING
                    else parser.cdata += c
                    continue

                case S.CDATA_ENDING:
                    if (c === "]") parser.state = S.CDATA_ENDING_2
                    else {
                        parser.cdata += "]" + c
                        parser.state = S.CDATA
                    }
                    continue

                case S.CDATA_ENDING_2:
                    if (c === ">") {
                        if (parser.cdata) emitNode(parser, "oncdata", parser.cdata)
                        emitNode(parser, "onclosecdata")
                        parser.cdata = ""
                        parser.state = S.TEXT
                    } else if (c === "]") {
                        parser.cdata += "]"
                    } else {
                        parser.cdata += "]]" + c
                        parser.state = S.CDATA
                    }
                    continue

                case S.PROC_INST:
                    if (c === "?") parser.state = S.PROC_INST_ENDING
                    else if (is(whitespace, c)) parser.state = S.PROC_INST_BODY
                    else parser.procInstName += c
                    continue

                case S.PROC_INST_BODY:
                    if (!parser.procInstBody && is(whitespace, c)) continue
                    else if (c === "?") parser.state = S.PROC_INST_ENDING
                    else parser.procInstBody += c
                    continue

                case S.PROC_INST_ENDING:
                    if (c === ">") {
                        emitNode(parser, "onprocessinginstruction", {
                            name : parser.procInstName,
                            body : parser.procInstBody
                        })
                        parser.procInstName = parser.procInstBody = ""
                        parser.state = S.TEXT
                    } else {
                        parser.procInstBody += "?" + c
                        parser.state = S.PROC_INST_BODY
                    }
                    continue

                case S.OPEN_TAG:
                    if (is(nameBody, c)) parser.tagName += c
                    else {
                        newTag(parser)
                        if (c === ">") openTag(parser)
                        else if (c === "/") parser.state = S.OPEN_TAG_SLASH
                        else {
                            if (not(whitespace, c)) strictFail(
                                parser, "Invalid character in tag name")
                            parser.state = S.ATTRIB
                        }
                    }
                    continue

                case S.OPEN_TAG_SLASH:
                    if (c === ">") {
                        openTag(parser, true)
                        closeTag(parser)
                    } else {
                        strictFail(parser, "Forward-slash in opening tag not followed by >")
                        parser.state = S.ATTRIB
                    }
                    continue

                case S.ATTRIB:
                    // haven't read the attribute name yet.
                    if (is(whitespace, c)) continue
                    else if (c === ">") openTag(parser)
                    else if (c === "/") parser.state = S.OPEN_TAG_SLASH
                    else if (is(nameStart, c)) {
                        parser.attribName = c
                        parser.attribValue = ""
                        parser.state = S.ATTRIB_NAME
                    } else strictFail(parser, "Invalid attribute name")
                    continue

                case S.ATTRIB_NAME:
                    if (c === "=") parser.state = S.ATTRIB_VALUE
                    else if (c === ">") {
                        strictFail(parser, "Attribute without value")
                        parser.attribValue = parser.attribName
                        attrib(parser)
                        openTag(parser)
                    }
                    else if (is(whitespace, c)) parser.state = S.ATTRIB_NAME_SAW_WHITE
                    else if (is(nameBody, c)) parser.attribName += c
                    else strictFail(parser, "Invalid attribute name")
                    continue

                case S.ATTRIB_NAME_SAW_WHITE:
                    if (c === "=") parser.state = S.ATTRIB_VALUE
                    else if (is(whitespace, c)) continue
                    else {
                        strictFail(parser, "Attribute without value")
                        parser.tag.attributes[parser.attribName] = ""
                        parser.attribValue = ""
                        emitNode(parser, "onattribute",
                            { name : parser.attribName, value : "" })
                        parser.attribName = ""
                        if (c === ">") openTag(parser)
                        else if (is(nameStart, c)) {
                            parser.attribName = c
                            parser.state = S.ATTRIB_NAME
                        } else {
                            strictFail(parser, "Invalid attribute name")
                            parser.state = S.ATTRIB
                        }
                    }
                    continue

                case S.ATTRIB_VALUE:
                    if (is(whitespace, c)) continue
                    else if (is(quote, c)) {
                        parser.q = c
                        parser.state = S.ATTRIB_VALUE_QUOTED
                    } else {
                        strictFail(parser, "Unquoted attribute value")
                        parser.state = S.ATTRIB_VALUE_UNQUOTED
                        parser.attribValue = c
                    }
                    continue

                case S.ATTRIB_VALUE_QUOTED:
                    if (c !== parser.q) {
                        if (c === "&") parser.state = S.ATTRIB_VALUE_ENTITY_Q
                        else parser.attribValue += c
                        continue
                    }
                    attrib(parser)
                    parser.q = ""
                    parser.state = S.ATTRIB_VALUE_CLOSED
                    continue

                case S.ATTRIB_VALUE_CLOSED:
                    if (is(whitespace, c)) {
                        parser.state = S.ATTRIB
                    } else if (c === ">") openTag(parser)
                    else if (c === "/") parser.state = S.OPEN_TAG_SLASH
                    else if (is(nameStart, c)) {
                        strictFail(parser, "No whitespace between attributes")
                        parser.attribName = c
                        parser.attribValue = ""
                        parser.state = S.ATTRIB_NAME
                    } else strictFail(parser, "Invalid attribute name")
                    continue

                case S.ATTRIB_VALUE_UNQUOTED:
                    if (not(attribEnd,c)) {
                        if (c === "&") parser.state = S.ATTRIB_VALUE_ENTITY_U
                        else parser.attribValue += c
                        continue
                    }
                    attrib(parser)
                    if (c === ">") openTag(parser)
                    else parser.state = S.ATTRIB
                    continue

                case S.CLOSE_TAG:
                    if (!parser.tagName) {
                        if (is(whitespace, c)) continue
                        else if (not(nameStart, c)) {
                            if (parser.script) {
                                parser.script += "</" + c
                                parser.state = S.SCRIPT
                            } else {
                                strictFail(parser, "Invalid tagname in closing tag.")
                            }
                        } else parser.tagName = c
                    }
                    else if (c === ">") closeTag(parser)
                    else if (is(nameBody, c)) parser.tagName += c
                    else if (parser.script) {
                        parser.script += "</" + parser.tagName
                        parser.tagName = ""
                        parser.state = S.SCRIPT
                    } else {
                        if (not(whitespace, c)) strictFail(parser,
                            "Invalid tagname in closing tag")
                        parser.state = S.CLOSE_TAG_SAW_WHITE
                    }
                    continue

                case S.CLOSE_TAG_SAW_WHITE:
                    if (is(whitespace, c)) continue
                    if (c === ">") closeTag(parser)
                    else strictFail(parser, "Invalid characters in closing tag")
                    continue

                case S.TEXT_ENTITY:
                case S.ATTRIB_VALUE_ENTITY_Q:
                case S.ATTRIB_VALUE_ENTITY_U:
                    switch(parser.state) {
                        case S.TEXT_ENTITY:
                            var returnState = S.TEXT, buffer = "textNode"
                            break

                        case S.ATTRIB_VALUE_ENTITY_Q:
                            var returnState = S.ATTRIB_VALUE_QUOTED, buffer = "attribValue"
                            break

                        case S.ATTRIB_VALUE_ENTITY_U:
                            var returnState = S.ATTRIB_VALUE_UNQUOTED, buffer = "attribValue"
                            break
                    }
                    if (c === ";") {
                        parser[buffer] += parseEntity(parser)
                        parser.entity = ""
                        parser.state = returnState
                    }
                    else if (is(entity, c)) parser.entity += c
                    else {
                        strictFail(parser, "Invalid character entity")
                        parser[buffer] += "&" + parser.entity + c
                        parser.entity = ""
                        parser.state = returnState
                    }
                    continue

                default:
                    throw new Error(parser, "Unknown state: " + parser.state)
            }
        } // while
        // cdata blocks can get very big under normal conditions. emit and move on.
        // if (parser.state === S.CDATA && parser.cdata) {
        //   emitNode(parser, "oncdata", parser.cdata)
        //   parser.cdata = ""
        // }
        if (parser.position >= parser.bufferCheckPosition) checkBufferLength(parser)
        return parser
    }

    /*! http://mths.be/fromcodepoint v0.1.0 by @mathias */
    if (!String.fromCodePoint) {
        (function() {
            var stringFromCharCode = String.fromCharCode;
            var floor = Math.floor;
            var fromCodePoint = function() {
                var MAX_SIZE = 0x4000;
                var codeUnits = [];
                var highSurrogate;
                var lowSurrogate;
                var index = -1;
                var length = arguments.length;
                if (!length) {
                    return '';
                }
                var result = '';
                while (++index < length) {
                    var codePoint = Number(arguments[index]);
                    if (
                        !isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
                        codePoint < 0 || // not a valid Unicode code point
                        codePoint > 0x10FFFF || // not a valid Unicode code point
                        floor(codePoint) != codePoint // not an integer
                        ) {
                        throw RangeError('Invalid code point: ' + codePoint);
                    }
                    if (codePoint <= 0xFFFF) { // BMP code point
                        codeUnits.push(codePoint);
                    } else { // Astral code point; split in surrogate halves
                        // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
                        codePoint -= 0x10000;
                        highSurrogate = (codePoint >> 10) + 0xD800;
                        lowSurrogate = (codePoint % 0x400) + 0xDC00;
                        codeUnits.push(highSurrogate, lowSurrogate);
                    }
                    if (index + 1 == length || codeUnits.length > MAX_SIZE) {
                        result += stringFromCharCode.apply(null, codeUnits);
                        codeUnits.length = 0;
                    }
                }
                return result;
            };
            if (Object.defineProperty) {
                Object.defineProperty(String, 'fromCodePoint', {
                    'value': fromCodePoint,
                    'configurable': true,
                    'writable': true
                });
            } else {
                String.fromCodePoint = fromCodePoint;
            }
        }());
    }

    return sax;
});
/*
 * Copyright (C) 2014 Vanderbilt University, All rights reserved.
 *
 * Author: Patrik Meijer
 *
 * Converter from XML to Json using sax parser. See the doc of constructor for info on how to use.
 */

define('xmljsonconverter',['sax'], function (sax) {
    

    /**
     * XML2JSON converter, when instantiated invoke convert(xmlString) to get the corresponding JavaScript object.
     * @param {object} options - optional options.
     * @param {object} options.arrayElements - Dictionary where keys evaluated to true are treated as arrays in the
     *  generated javascript object. If not provided these will be inferred by number of occurrences of the elements.
     * @param {string} options.attrTag - will be prepended to attributes keys, default "@".
     * @param {string} options.textTag - the key values for text items, default "#text".
     * @param {boolean} options.skipWSText - if true then text made up of only white-space (including \n, \r, etc.)
     *  will not be generated as text-items in the javascript object, default false.
     * @constructor
     */
    var XML2JSON = function (options) {
        var self = this,
            opts = options || {},
            attrTag = opts.attrTag,
            textTag = opts.textTag || '#text',
            skipWS = opts.skipWSText;
        if (attrTag === undefined) {
            attrTag = '@';
        }
        self.rootNode = {};
        self.stack = [];
        self.nsStack = [];
        self.parser = sax.parser(true);
        // TODO make this configurable
        self.nsMap = {
            "http://www.w3.org/2001/XMLSchema-instance": "xsi",
            "http://www.w3.org/2001/XMLSchema": "xsd",
            };

        self.parser.ontext = function (text) {
            if (self.stack.length > 0) {
                if (skipWS) {
                    if (text.replace(/\s+?/g, '')) {
                        self.stack[self.stack.length - 1][textTag] = text;
                    }
                } else {
                    self.stack[self.stack.length - 1][textTag] = text;
                }
            }
        };

        function mapNamespace(ns, value) {
            var colon = value.indexOf(':');
            if (colon === -1) {
                return value;
            }
            var namespace = value.substr(0, colon);
            if (namespace in ns) {
                return (self.nsMap[ns[namespace]] || ns[namespace]) + ':' + value.substr(colon + 1);
            }
            return value;
        };
        self.parser.onopentag = function (node) {
            var key,
                i,
                parentNode,
                node_name,
                jsonNode = {};

            var ns = {};
            for (key in node.attributes) {
                if (node.attributes.hasOwnProperty(key)) {
                    if (key.substr(0, 6) === 'xmlns:') {
                        ns[key.substr('xmlns:'.length)] = node.attributes[key];
                    }
                    if (key === 'xmlns') {
                        ns[''] = node.attributes['xmlns'];
                    }
                }
            }
            if (Object.getOwnPropertyNames(ns).length === 0) {
                if (self.nsStack.length > 0) {
                    ns = self.nsStack[self.nsStack.length - 1];
                }
                self.nsStack.push(ns);
            } else {
                for (i = self.nsStack.length - 1; i >= 0; i--) {
                    for (key in self.nsStack[i]) {
                        if (!ns.hasOwnProperty(key) && self.nsStack[i].hasOwnProperty(key)) {
                            ns[key] = self.nsStack[i][key];
                        }
                    }
                }
                self.nsStack.push(ns);
            }
            node_name = mapNamespace(ns, node.name);
            if (self.stack.length === 0) {
                self.rootNode[node_name] = jsonNode;
            } else {
                parentNode = self.stack[self.stack.length - 1];
                if (opts.arrayElements) {
                    self.arrayElements = opts.arrayElements;
                    if (self.arrayElements[node_name]) {
                        if (parentNode.hasOwnProperty(node_name)) {
                            parentNode[node_name].push(jsonNode);
                        } else {
                            parentNode[node_name] = [jsonNode];
                        }
                    } else {
                        parentNode[node_name] = jsonNode;
                    }
                } else {
                    if (parentNode.hasOwnProperty(node_name)) {
                        if (parentNode[node_name] instanceof Array) {
                            parentNode[node_name].push(jsonNode);
                        } else {
                            parentNode[node_name] = [parentNode[node_name], jsonNode];
                        }
                    } else {
                        parentNode[node_name] = jsonNode;
                    }
                }
            }
            self.stack.push(jsonNode);
            for (key in node.attributes) {
                if (node.attributes.hasOwnProperty(key)) {
                    var namespaceKey = mapNamespace(ns, key);
                    if (namespaceKey === "xsi:type") {
                        // the attribute value should be mapped too
                        jsonNode[attrTag + namespaceKey] = mapNamespace(ns, node.attributes[key]);
                    } else {
                        jsonNode[attrTag + namespaceKey] = node.attributes[key];
                    }
                }
            }
        };

        self.parser.onclosetag = function (node) {
            self.stack.pop();
            self.nsStack.pop();
        };

        self.parser.onerror = function (error) {
            self.rootNode = error;
            self.parser.error = null;
        };
    };

    /**
     * Converts the xml in the given string to a javascript object. For bigger xmls use convertFromBuffer instead.
     * @param {string} xmlString - xml string representation to convert.
     * @returns {object|Error} - Javascript object inferred from the xml, Error object if failed.
     */
    XML2JSON.prototype.convertFromString = function (xmlString) {
        this.rootNode = {};
        this.stack = [];
        this.parser.write(xmlString).close();
        return this.rootNode;
    };

    /**
     * Converts the xml to a javascript object (JSON).
     * @param xmlBuffer {ArrayBuffer} - xml to convert.
     * @param options {object} - optional options.
     * @param options.segmentSize {int} - length of string segments, default 10000.
     * @param options.encoding {TypedArray constructor} - encoding of the ArrayBuffer, default Uint8Array.
     * @returns {object|Error} - Javascript object inferred from the xml, Error object if failed.
     */
    XML2JSON.prototype.convertFromBuffer = function (xmlBuffer, options) {
        var opts = options || {},
            segmentSize = opts.segmentSize || 10000,
            encode = opts.encoding || Uint8Array,
            data = new encode(xmlBuffer),
            dataSegment,
            nbrOfIterations = Math.ceil(data.length / segmentSize),
            startIndex = 0,
            i;
        this.rootNode = {};
        this.stack = [];
        for (i = 0; i < nbrOfIterations; i += 1) {
            dataSegment = data.subarray(startIndex, startIndex + segmentSize);
            startIndex += segmentSize;
            if (i < nbrOfIterations - 1) {
                this.parser.write(String.fromCharCode.apply(null, dataSegment));
            } else {
                this.parser.write(String.fromCharCode.apply(null, dataSegment)).close();
            }
        }
        return this.rootNode;
    };

    /**
     * XML2JSON converter, when instantiated invoke convert(xmlString) to get the corresponding JavaScript object.
     * @param {object} options - optional options.
     * @param {string} options.attrTag - keys with this will be treated as attributes, default "@".
     * @param {string} options.textTag - the key values for text items, default "#text".
     * @param {string} options.xmlDeclaration - the xmlDeclaration, default "<?xml version="1.0"?>".
     * @constructor
     */
    var JSON2XML = function (options) {
        var opts = options || {},
            attrTag = opts.attrTag,
            textTag = opts.textTag || '#text',
            xmlDeclaration = opts.xmlDeclaration || '<?xml version="1.0"?>';
        if (attrTag === undefined) {
            attrTag = '@';
        }
        this.attrTag = attrTag;
        this.attrTagIndex = this.attrTag.length;
        this.textTag = textTag;
        this.xmlDeclaration = xmlDeclaration;
    };

    JSON2XML.prototype._convertToStringRec = function (key, value) {
        var subKeys,
            elemTag = '',
            i,
            content = '';
        if (value instanceof Array) {
            for (i = 0; i < value.length; i += 1) {
                content += this._convertToStringRec(key, value[i]);
            }
            return content;
        }
        if (value instanceof Object) {
            subKeys = Object.keys(value);
            for (i = 0; i < subKeys.length; i += 1) {
                if (value[subKeys[i]] instanceof Object) {
                    content += this._convertToStringRec(subKeys[i], value[subKeys[i]]);
                } else {
                    if (subKeys[i].slice(0, this.attrTag.length) === this.attrTag) {
                        if (value[subKeys[i]] === null) {
                            elemTag += ' ' + subKeys[i].substr(this.attrTagIndex) + '=""';
                        } else {
                            elemTag += ' ' + subKeys[i].substr(this.attrTagIndex) + '="' + value[subKeys[i]].toString() + '"';
                        }
                    } else if (subKeys[i] === this.textTag) {
                        content += value[subKeys[i]].toString();
                    } else {
                        content += this._convertToStringRec(subKeys[i], value[subKeys[i]]);
                    }
                }
            }
        } else if (value) {
            content += '<' + value.toString() + '></' + value.toString() + '>';
        }

        if (content) {
            return '<' + key + elemTag + '>' + content + '</' + key + '>';
        }

        return '<' + key + elemTag + '/>';
    };

    JSON2XML.prototype.convertToString = function (jsonObj) {
        var keys = Object.keys(jsonObj),
            i;
        this.xml = this.xmlDeclaration;
        for (i = 0; i < keys.length; i += 1) {
            this.xml += this._convertToStringRec(keys[i], jsonObj[keys[i]]);
        }
        return this.xml;
    };

    return {
        Xml2json: XML2JSON,
        Json2xml: JSON2XML
    };
});
;(function(){

/**
 * Require the given path.
 *
 * @param {String} path
 * @return {Object} exports
 * @api public
 */

function require(path, parent, orig) {
  var resolved = require.resolve(path);

  // lookup failed
  if (null == resolved) {
    orig = orig || path;
    parent = parent || 'root';
    var err = new Error('Failed to require "' + orig + '" from "' + parent + '"');
    err.path = orig;
    err.parent = parent;
    err.require = true;
    throw err;
  }

  var module = require.modules[resolved];

  // perform real require()
  // by invoking the module's
  // registered function
  if (!module._resolving && !module.exports) {
    var mod = {};
    mod.exports = {};
    mod.client = mod.component = true;
    module._resolving = true;
    module.call(this, mod.exports, require.relative(resolved), mod);
    delete module._resolving;
    module.exports = mod.exports;
  }

  return module.exports;
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Registered aliases.
 */

require.aliases = {};

/**
 * Resolve `path`.
 *
 * Lookup:
 *
 *   - PATH/index.js
 *   - PATH.js
 *   - PATH
 *
 * @param {String} path
 * @return {String} path or null
 * @api private
 */

require.resolve = function(path) {
  if (path.charAt(0) === '/') path = path.slice(1);

  var paths = [
    path,
    path + '.js',
    path + '.json',
    path + '/index.js',
    path + '/index.json'
  ];

  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (require.modules.hasOwnProperty(path)) return path;
    if (require.aliases.hasOwnProperty(path)) return require.aliases[path];
  }
};

/**
 * Normalize `path` relative to the current path.
 *
 * @param {String} curr
 * @param {String} path
 * @return {String}
 * @api private
 */

require.normalize = function(curr, path) {
  var segs = [];

  if ('.' != path.charAt(0)) return path;

  curr = curr.split('/');
  path = path.split('/');

  for (var i = 0; i < path.length; ++i) {
    if ('..' == path[i]) {
      curr.pop();
    } else if ('.' != path[i] && '' != path[i]) {
      segs.push(path[i]);
    }
  }

  return curr.concat(segs).join('/');
};

/**
 * Register module at `path` with callback `definition`.
 *
 * @param {String} path
 * @param {Function} definition
 * @api private
 */

require.register = function(path, definition) {
  require.modules[path] = definition;
};

/**
 * Alias a module definition.
 *
 * @param {String} from
 * @param {String} to
 * @api private
 */

require.alias = function(from, to) {
  if (!require.modules.hasOwnProperty(from)) {
    throw new Error('Failed to alias "' + from + '", it does not exist');
  }
  require.aliases[to] = from;
};

/**
 * Return a require function relative to the `parent` path.
 *
 * @param {String} parent
 * @return {Function}
 * @api private
 */

require.relative = function(parent) {
  var p = require.normalize(parent, '..');

  /**
   * lastIndexOf helper.
   */

  function lastIndexOf(arr, obj) {
    var i = arr.length;
    while (i--) {
      if (arr[i] === obj) return i;
    }
    return -1;
  }

  /**
   * The relative require() itself.
   */

  function localRequire(path) {
    var resolved = localRequire.resolve(path);
    return require(resolved, parent, path);
  }

  /**
   * Resolve relative to the parent.
   */

  localRequire.resolve = function(path) {
    var c = path.charAt(0);
    if ('/' == c) return path.slice(1);
    if ('.' == c) return require.normalize(p, path);

    // resolve deps by returning
    // the dep in the nearest "deps"
    // directory
    var segs = parent.split('/');
    var i = lastIndexOf(segs, 'deps') + 1;
    if (!i) i = 0;
    path = segs.slice(0, i + 1).join('/') + '/deps/' + path;
    return path;
  };

  /**
   * Check if module is defined at `path`.
   */

  localRequire.exists = function(path) {
    return require.modules.hasOwnProperty(localRequire.resolve(path));
  };

  return localRequire;
};
require.register("component-emitter/index.js", function(exports, require, module){

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks[event] = this._callbacks[event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks[event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks[event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

});
require.register("component-reduce/index.js", function(exports, require, module){

/**
 * Reduce `arr` with `fn`.
 *
 * @param {Array} arr
 * @param {Function} fn
 * @param {Mixed} initial
 *
 * TODO: combatible error handling?
 */

module.exports = function(arr, fn, initial){  
  var idx = 0;
  var len = arr.length;
  var curr = arguments.length == 3
    ? initial
    : arr[idx++];

  while (idx < len) {
    curr = fn.call(null, curr, arr[idx], ++idx, arr);
  }
  
  return curr;
};
});
require.register("superagent/lib/client.js", function(exports, require, module){
/**
 * Module dependencies.
 */

var Emitter = require('emitter');
var reduce = require('reduce');

/**
 * Root reference for iframes.
 */

var root = 'undefined' == typeof window
  ? this
  : window;

/**
 * Noop.
 */

function noop(){};

/**
 * Check if `obj` is a host object,
 * we don't want to serialize these :)
 *
 * TODO: future proof, move to compoent land
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isHost(obj) {
  var str = {}.toString.call(obj);

  switch (str) {
    case '[object File]':
    case '[object Blob]':
    case '[object FormData]':
      return true;
    default:
      return false;
  }
}

/**
 * Determine XHR.
 */

function getXHR() {
  if (root.XMLHttpRequest
    && ('file:' != root.location.protocol || !root.ActiveXObject)) {
    return new XMLHttpRequest;
  } else {
    try { return new ActiveXObject('Microsoft.XMLHTTP'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.6.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP.3.0'); } catch(e) {}
    try { return new ActiveXObject('Msxml2.XMLHTTP'); } catch(e) {}
  }
  return false;
}

/**
 * Removes leading and trailing whitespace, added to support IE.
 *
 * @param {String} s
 * @return {String}
 * @api private
 */

var trim = ''.trim
  ? function(s) { return s.trim(); }
  : function(s) { return s.replace(/(^\s*|\s*$)/g, ''); };

/**
 * Check if `obj` is an object.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isObject(obj) {
  return obj === Object(obj);
}

/**
 * Serialize the given `obj`.
 *
 * @param {Object} obj
 * @return {String}
 * @api private
 */

function serialize(obj) {
  if (!isObject(obj)) return obj;
  var pairs = [];
  for (var key in obj) {
    if (null != obj[key]) {
      pairs.push(encodeURIComponent(key)
        + '=' + encodeURIComponent(obj[key]));
    }
  }
  return pairs.join('&');
}

/**
 * Expose serialization method.
 */

 request.serializeObject = serialize;

 /**
  * Parse the given x-www-form-urlencoded `str`.
  *
  * @param {String} str
  * @return {Object}
  * @api private
  */

function parseString(str) {
  var obj = {};
  var pairs = str.split('&');
  var parts;
  var pair;

  for (var i = 0, len = pairs.length; i < len; ++i) {
    pair = pairs[i];
    parts = pair.split('=');
    obj[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  }

  return obj;
}

/**
 * Expose parser.
 */

request.parseString = parseString;

/**
 * Default MIME type map.
 *
 *     superagent.types.xml = 'application/xml';
 *
 */

request.types = {
  html: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  urlencoded: 'application/x-www-form-urlencoded',
  'form': 'application/x-www-form-urlencoded',
  'form-data': 'application/x-www-form-urlencoded'
};

/**
 * Default serialization map.
 *
 *     superagent.serialize['application/xml'] = function(obj){
 *       return 'generated xml here';
 *     };
 *
 */

 request.serialize = {
   'application/x-www-form-urlencoded': serialize,
   'application/json': JSON.stringify
 };

 /**
  * Default parsers.
  *
  *     superagent.parse['application/xml'] = function(str){
  *       return { object parsed from str };
  *     };
  *
  */

request.parse = {
  'application/x-www-form-urlencoded': parseString,
  'application/json': JSON.parse
};

/**
 * Parse the given header `str` into
 * an object containing the mapped fields.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function parseHeader(str) {
  var lines = str.split(/\r?\n/);
  var fields = {};
  var index;
  var line;
  var field;
  var val;

  lines.pop(); // trailing CRLF

  for (var i = 0, len = lines.length; i < len; ++i) {
    line = lines[i];
    index = line.indexOf(':');
    field = line.slice(0, index).toLowerCase();
    val = trim(line.slice(index + 1));
    fields[field] = val;
  }

  return fields;
}

/**
 * Return the mime type for the given `str`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function type(str){
  return str.split(/ *; */).shift();
};

/**
 * Return header field parameters.
 *
 * @param {String} str
 * @return {Object}
 * @api private
 */

function params(str){
  return reduce(str.split(/ *; */), function(obj, str){
    var parts = str.split(/ *= */)
      , key = parts.shift()
      , val = parts.shift();

    if (key && val) obj[key] = val;
    return obj;
  }, {});
};

/**
 * Initialize a new `Response` with the given `xhr`.
 *
 *  - set flags (.ok, .error, etc)
 *  - parse header
 *
 * Examples:
 *
 *  Aliasing `superagent` as `request` is nice:
 *
 *      request = superagent;
 *
 *  We can use the promise-like API, or pass callbacks:
 *
 *      request.get('/').end(function(res){});
 *      request.get('/', function(res){});
 *
 *  Sending data can be chained:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' })
 *        .end(function(res){});
 *
 *  Or passed to `.send()`:
 *
 *      request
 *        .post('/user')
 *        .send({ name: 'tj' }, function(res){});
 *
 *  Or passed to `.post()`:
 *
 *      request
 *        .post('/user', { name: 'tj' })
 *        .end(function(res){});
 *
 * Or further reduced to a single call for simple cases:
 *
 *      request
 *        .post('/user', { name: 'tj' }, function(res){});
 *
 * @param {XMLHTTPRequest} xhr
 * @param {Object} options
 * @api private
 */

function Response(req, options) {
  options = options || {};
  this.req = req;
  this.xhr = this.req.xhr;
  this.text = this.xhr.responseText;
  this.setStatusProperties(this.xhr.status);
  this.header = this.headers = parseHeader(this.xhr.getAllResponseHeaders());
  // getAllResponseHeaders sometimes falsely returns "" for CORS requests, but
  // getResponseHeader still works. so we get content-type even if getting
  // other headers fails.
  this.header['content-type'] = this.xhr.getResponseHeader('content-type');
  this.setHeaderProperties(this.header);
  this.body = this.req.method != 'HEAD'
    ? this.parseBody(this.text)
    : null;
}

/**
 * Get case-insensitive `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */

Response.prototype.get = function(field){
  return this.header[field.toLowerCase()];
};

/**
 * Set header related properties:
 *
 *   - `.type` the content type without params
 *
 * A response of "Content-Type: text/plain; charset=utf-8"
 * will provide you with a `.type` of "text/plain".
 *
 * @param {Object} header
 * @api private
 */

Response.prototype.setHeaderProperties = function(header){
  // content-type
  var ct = this.header['content-type'] || '';
  this.type = type(ct);

  // params
  var obj = params(ct);
  for (var key in obj) this[key] = obj[key];
};

/**
 * Parse the given body `str`.
 *
 * Used for auto-parsing of bodies. Parsers
 * are defined on the `superagent.parse` object.
 *
 * @param {String} str
 * @return {Mixed}
 * @api private
 */

Response.prototype.parseBody = function(str){
  var parse = request.parse[this.type];
  return parse
    ? parse(str)
    : null;
};

/**
 * Set flags such as `.ok` based on `status`.
 *
 * For example a 2xx response will give you a `.ok` of __true__
 * whereas 5xx will be __false__ and `.error` will be __true__. The
 * `.clientError` and `.serverError` are also available to be more
 * specific, and `.statusType` is the class of error ranging from 1..5
 * sometimes useful for mapping respond colors etc.
 *
 * "sugar" properties are also defined for common cases. Currently providing:
 *
 *   - .noContent
 *   - .badRequest
 *   - .unauthorized
 *   - .notAcceptable
 *   - .notFound
 *
 * @param {Number} status
 * @api private
 */

Response.prototype.setStatusProperties = function(status){
  var type = status / 100 | 0;

  // status / class
  this.status = status;
  this.statusType = type;

  // basics
  this.info = 1 == type;
  this.ok = 2 == type;
  this.clientError = 4 == type;
  this.serverError = 5 == type;
  this.error = (4 == type || 5 == type)
    ? this.toError()
    : false;

  // sugar
  this.accepted = 202 == status;
  this.noContent = 204 == status || 1223 == status;
  this.badRequest = 400 == status;
  this.unauthorized = 401 == status;
  this.notAcceptable = 406 == status;
  this.notFound = 404 == status;
  this.forbidden = 403 == status;
};

/**
 * Return an `Error` representative of this response.
 *
 * @return {Error}
 * @api public
 */

Response.prototype.toError = function(){
  var req = this.req;
  var method = req.method;
  var url = req.url;

  var msg = 'cannot ' + method + ' ' + url + ' (' + this.status + ')';
  var err = new Error(msg);
  err.status = this.status;
  err.method = method;
  err.url = url;

  return err;
};

/**
 * Expose `Response`.
 */

request.Response = Response;

/**
 * Initialize a new `Request` with the given `method` and `url`.
 *
 * @param {String} method
 * @param {String} url
 * @api public
 */

function Request(method, url) {
  var self = this;
  Emitter.call(this);
  this._query = this._query || [];
  this.method = method;
  this.url = url;
  this.header = {};
  this._header = {};
  this.on('end', function(){
    var res = new Response(self);
    if ('HEAD' == method) res.text = null;
    self.callback(null, res);
  });
}

/**
 * Mixin `Emitter`.
 */

Emitter(Request.prototype);

/**
 * Allow for extension
 */

Request.prototype.use = function(fn) {
  fn(this);
  return this;
}

/**
 * Set timeout to `ms`.
 *
 * @param {Number} ms
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.timeout = function(ms){
  this._timeout = ms;
  return this;
};

/**
 * Clear previous timeout.
 *
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.clearTimeout = function(){
  this._timeout = 0;
  clearTimeout(this._timer);
  return this;
};

/**
 * Abort the request, and clear potential timeout.
 *
 * @return {Request}
 * @api public
 */

Request.prototype.abort = function(){
  if (this.aborted) return;
  this.aborted = true;
  this.xhr.abort();
  this.clearTimeout();
  this.emit('abort');
  return this;
};

/**
 * Set header `field` to `val`, or multiple fields with one object.
 *
 * Examples:
 *
 *      req.get('/')
 *        .set('Accept', 'application/json')
 *        .set('X-API-Key', 'foobar')
 *        .end(callback);
 *
 *      req.get('/')
 *        .set({ Accept: 'application/json', 'X-API-Key': 'foobar' })
 *        .end(callback);
 *
 * @param {String|Object} field
 * @param {String} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.set = function(field, val){
  if (isObject(field)) {
    for (var key in field) {
      this.set(key, field[key]);
    }
    return this;
  }
  this._header[field.toLowerCase()] = val;
  this.header[field] = val;
  return this;
};

/**
 * Get case-insensitive header `field` value.
 *
 * @param {String} field
 * @return {String}
 * @api private
 */

Request.prototype.getHeader = function(field){
  return this._header[field.toLowerCase()];
};

/**
 * Set Content-Type to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.xml = 'application/xml';
 *
 *      request.post('/')
 *        .type('xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 *      request.post('/')
 *        .type('application/xml')
 *        .send(xmlstring)
 *        .end(callback);
 *
 * @param {String} type
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.type = function(type){
  this.set('Content-Type', request.types[type] || type);
  return this;
};

/**
 * Set Accept to `type`, mapping values from `request.types`.
 *
 * Examples:
 *
 *      superagent.types.json = 'application/json';
 *
 *      request.get('/agent')
 *        .accept('json')
 *        .end(callback);
 *
 *      request.get('/agent')
 *        .accept('application/json')
 *        .end(callback);
 *
 * @param {String} accept
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.accept = function(type){
  this.set('Accept', request.types[type] || type);
  return this;
};

/**
 * Set Authorization field value with `user` and `pass`.
 *
 * @param {String} user
 * @param {String} pass
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.auth = function(user, pass){
  var str = btoa(user + ':' + pass);
  this.set('Authorization', 'Basic ' + str);
  return this;
};

/**
* Add query-string `val`.
*
* Examples:
*
*   request.get('/shoes')
*     .query('size=10')
*     .query({ color: 'blue' })
*
* @param {Object|String} val
* @return {Request} for chaining
* @api public
*/

Request.prototype.query = function(val){
  if ('string' != typeof val) val = serialize(val);
  if (val) this._query.push(val);
  return this;
};

/**
 * Write the field `name` and `val` for "multipart/form-data"
 * request bodies.
 *
 * ``` js
 * request.post('/upload')
 *   .field('foo', 'bar')
 *   .end(callback);
 * ```
 *
 * @param {String} name
 * @param {String|Blob|File} val
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.field = function(name, val){
  if (!this._formData) this._formData = new FormData();
  this._formData.append(name, val);
  return this;
};

/**
 * Queue the given `file` as an attachment to the specified `field`,
 * with optional `filename`.
 *
 * ``` js
 * request.post('/upload')
 *   .attach(new Blob(['<a id="a"><b id="b">hey!</b></a>'], { type: "text/html"}))
 *   .end(callback);
 * ```
 *
 * @param {String} field
 * @param {Blob|File} file
 * @param {String} filename
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.attach = function(field, file, filename){
  if (!this._formData) this._formData = new FormData();
  this._formData.append(field, file, filename);
  return this;
};

/**
 * Send `data`, defaulting the `.type()` to "json" when
 * an object is given.
 *
 * Examples:
 *
 *       // querystring
 *       request.get('/search')
 *         .end(callback)
 *
 *       // multiple data "writes"
 *       request.get('/search')
 *         .send({ search: 'query' })
 *         .send({ range: '1..5' })
 *         .send({ order: 'desc' })
 *         .end(callback)
 *
 *       // manual json
 *       request.post('/user')
 *         .type('json')
 *         .send('{"name":"tj"})
 *         .end(callback)
 *
 *       // auto json
 *       request.post('/user')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // manual x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send('name=tj')
 *         .end(callback)
 *
 *       // auto x-www-form-urlencoded
 *       request.post('/user')
 *         .type('form')
 *         .send({ name: 'tj' })
 *         .end(callback)
 *
 *       // defaults to x-www-form-urlencoded
  *      request.post('/user')
  *        .send('name=tobi')
  *        .send('species=ferret')
  *        .end(callback)
 *
 * @param {String|Object} data
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.send = function(data){
  var obj = isObject(data);
  var type = this.getHeader('Content-Type');

  // merge
  if (obj && isObject(this._data)) {
    for (var key in data) {
      this._data[key] = data[key];
    }
  } else if ('string' == typeof data) {
    if (!type) this.type('form');
    type = this.getHeader('Content-Type');
    if ('application/x-www-form-urlencoded' == type) {
      this._data = this._data
        ? this._data + '&' + data
        : data;
    } else {
      this._data = (this._data || '') + data;
    }
  } else {
    this._data = data;
  }

  if (!obj) return this;
  if (!type) this.type('json');
  return this;
};

/**
 * Invoke the callback with `err` and `res`
 * and handle arity check.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

Request.prototype.callback = function(err, res){
  var fn = this._callback;
  if (2 == fn.length) return fn(err, res);
  if (err) return this.emit('error', err);
  fn(res);
};

/**
 * Invoke callback with x-domain error.
 *
 * @api private
 */

Request.prototype.crossDomainError = function(){
  var err = new Error('Origin is not allowed by Access-Control-Allow-Origin');
  err.crossDomain = true;
  this.callback(err);
};

/**
 * Invoke callback with timeout error.
 *
 * @api private
 */

Request.prototype.timeoutError = function(){
  var timeout = this._timeout;
  var err = new Error('timeout of ' + timeout + 'ms exceeded');
  err.timeout = timeout;
  this.callback(err);
};

/**
 * Enable transmission of cookies with x-domain requests.
 *
 * Note that for this to work the origin must not be
 * using "Access-Control-Allow-Origin" with a wildcard,
 * and also must set "Access-Control-Allow-Credentials"
 * to "true".
 *
 * @api public
 */

Request.prototype.withCredentials = function(){
  this._withCredentials = true;
  return this;
};

/**
 * Initiate request, invoking callback `fn(res)`
 * with an instanceof `Response`.
 *
 * @param {Function} fn
 * @return {Request} for chaining
 * @api public
 */

Request.prototype.end = function(fn){
  var self = this;
  var xhr = this.xhr = getXHR();
  var query = this._query.join('&');
  var timeout = this._timeout;
  var data = this._formData || this._data;

  // store callback
  this._callback = fn || noop;

  // state change
  xhr.onreadystatechange = function(){
    if (4 != xhr.readyState) return;
    if (0 == xhr.status) {
      if (self.aborted) return self.timeoutError();
      return self.crossDomainError();
    }
    self.emit('end');
  };

  // progress
  if (xhr.upload) {
    xhr.upload.onprogress = function(e){
      e.percent = e.loaded / e.total * 100;
      self.emit('progress', e);
    };
  }

  // timeout
  if (timeout && !this._timer) {
    this._timer = setTimeout(function(){
      self.abort();
    }, timeout);
  }

  // querystring
  if (query) {
    query = request.serializeObject(query);
    this.url += ~this.url.indexOf('?')
      ? '&' + query
      : '?' + query;
  }

  // initiate request
  xhr.open(this.method, this.url, true);

  // CORS
  if (this._withCredentials) xhr.withCredentials = true;

  // body
  if ('GET' != this.method && 'HEAD' != this.method && 'string' != typeof data && !isHost(data)) {
    // serialize stuff
    var serialize = request.serialize[this.getHeader('Content-Type')];
    if (serialize) data = serialize(data);
  }

  // set header fields
  for (var field in this.header) {
    if (null == this.header[field]) continue;
    xhr.setRequestHeader(field, this.header[field]);
  }

  // send stuff
  this.emit('request', this);
  xhr.send(data);
  return this;
};

/**
 * Expose `Request`.
 */

request.Request = Request;

/**
 * Issue a request:
 *
 * Examples:
 *
 *    request('GET', '/users').end(callback)
 *    request('/users').end(callback)
 *    request('/users', callback)
 *
 * @param {String} method
 * @param {String|Function} url or callback
 * @return {Request}
 * @api public
 */

function request(method, url) {
  // callback
  if ('function' == typeof url) {
    return new Request('GET', method).end(url);
  }

  // url first
  if (1 == arguments.length) {
    return new Request('GET', method);
  }

  return new Request(method, url);
}

/**
 * GET `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.get = function(url, data, fn){
  var req = request('GET', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.query(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * HEAD `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.head = function(url, data, fn){
  var req = request('HEAD', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * DELETE `url` with optional callback `fn(res)`.
 *
 * @param {String} url
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.del = function(url, fn){
  var req = request('DELETE', url);
  if (fn) req.end(fn);
  return req;
};

/**
 * PATCH `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.patch = function(url, data, fn){
  var req = request('PATCH', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * POST `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed} data
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.post = function(url, data, fn){
  var req = request('POST', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * PUT `url` with optional `data` and callback `fn(res)`.
 *
 * @param {String} url
 * @param {Mixed|Function} data or fn
 * @param {Function} fn
 * @return {Request}
 * @api public
 */

request.put = function(url, data, fn){
  var req = request('PUT', url);
  if ('function' == typeof data) fn = data, data = null;
  if (data) req.send(data);
  if (fn) req.end(fn);
  return req;
};

/**
 * Expose `request`.
 */

module.exports = request;

});




require.alias("component-emitter/index.js", "superagent/deps/emitter/index.js");
require.alias("component-emitter/index.js", "emitter/index.js");

require.alias("component-reduce/index.js", "superagent/deps/reduce/index.js");
require.alias("component-reduce/index.js", "reduce/index.js");

require.alias("superagent/lib/client.js", "superagent/index.js");if (typeof exports == "object") {
  module.exports = require("superagent");
} else if (typeof define == "function" && define.amd) {
  define('superagent',[], function(){ return require("superagent"); });
} else {
  this["superagent"] = require("superagent");
}})();
/**
 * Created by Zsolt on 5/21/2014.
 * 
 * THIS IS A THROW AWAY CODE AND IMPLEMENTATION.
 *
 * TEMPORARY CODE AND IMPLEMENTATION.
 *
 */


define('executor/ExecutorClient',['superagent'], function (superagent) {

    var ExecutorClient = function (parameters) {
        parameters = parameters || {};
        this.isNodeJS = (typeof window === 'undefined') && (typeof process === "object");
        this.isNodeWebkit = (typeof window === 'object') && (typeof process === "object");

        //console.log(isNode);
        if (this.isNodeJS) {
            var config = webGMEGlobal.getConfig();
            this.server = '127.0.0.1';
            this.serverPort = config.port;
            this.httpsecure = config.httpsecure;

            this._clientSession = null; // parameters.sessionId;;
        }
        this.server = parameters.server || this.server;
        this.serverPort = parameters.serverPort || this.serverPort;
        this.httpsecure = (parameters.httpsecure !== undefined) ? parameters.httpsecure : this.httpsecure;
        if (this.isNodeJS) {
            this.http = this.httpsecure ? require('https') : require('http');
        }
        this.executorUrl = '';
        if (this.httpsecure !== undefined && this.server && this.serverPort) {
            this.executorUrl = (this.httpsecure ? 'https://' : 'http://') + this.server + ':' + this.serverPort;
        }
        // TODO: TOKEN???
        this.executorUrl = this.executorUrl + '/rest/external/executor/'; // TODO: any ways to ask for this or get it from the configuration?
        if (parameters.executorNonce) {
            this.executorNonce = parameters.executorNonce;
        } else if (typeof webGMEGlobal !== "undefined") {
            var webGMEConfig = webGMEGlobal.getConfig();
            if (webGMEConfig.executorNonce) {
                this.executorNonce = webGMEConfig.executorNonce;
            }
        }
    };

    ExecutorClient.prototype.getInfoURL = function (hash) {
        var metadataBase = this.executorUrl + 'info';
        if (hash) {
            return metadataBase + '/' + hash;
        } else {
            return metadataBase;
        }
    };


    ExecutorClient.prototype.getCreateURL = function (hash) {
        var metadataBase = this.executorUrl + 'create';
        if (hash) {
            return metadataBase + '/' + hash;
        } else {
            return metadataBase;
        }
    };

    ExecutorClient.prototype.createJob = function (jobInfo, callback) {
        if (typeof jobInfo === 'string') {
            jobInfo = { hash: jobInfo }; // old API
        }
        this.sendHttpRequestWithData('POST', this.getCreateURL(jobInfo.hash), jobInfo, function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, JSON.parse(response));
        });
    };

    ExecutorClient.prototype.updateJob = function (jobInfo, callback) {
        this.sendHttpRequestWithData('POST', this.executorUrl + 'update/' + jobInfo.hash, jobInfo, function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, response);
        });
    };

    ExecutorClient.prototype.getInfo = function (hash, callback) {
        this.sendHttpRequest('GET', this.getInfoURL(hash), function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, JSON.parse(response));
        });
    };

    ExecutorClient.prototype.getAllInfo = function (callback) {

        this.sendHttpRequest('GET', this.getInfoURL(), function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, JSON.parse(response));
        });
    };

    ExecutorClient.prototype.getInfoByStatus = function (status, callback) {

        this.sendHttpRequest('GET', this.executorUrl + '?status=' + status, function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, JSON.parse(response));
        });
    };

    ExecutorClient.prototype.getWorkersInfo = function (callback) {

        this.sendHttpRequest('GET', this.executorUrl + 'worker', function (err, response) {
            if (err) {
                callback(err);
                return;
            }

            callback(null, JSON.parse(response));
        });
    };

    ExecutorClient.prototype.sendHttpRequest = function (method, url, callback) {
        return this.sendHttpRequestWithData(method, url, null, callback);
    };

    ExecutorClient.prototype.sendHttpRequestWithData = function (method, url, data, callback) {
        var req = new superagent.Request(method, url);
        if (this.executorNonce) {
            req.set('x-executor-nonce', this.executorNonce);
        }
        if (data) {
            req.send(data);
        }
        req.end(function (err, res) {
            if (err) {
                callback(err);
                return;
            }
            if (res.status > 399) {
                callback(res.status, res.text);
            } else {
                callback(null, res.text);
            }
        });
    };

    ExecutorClient.prototype._ensureAuthenticated = function (options, callback) {
        //this function enables the session of the client to be authenticated
        //TODO currently this user does not have a session, so it has to upgrade the options always!!!
//        if (options.headers) {
//            options.headers.webgmeclientsession = this._clientSession;
//        } else {
//            options.headers = {
//                'webgmeclientsession': this._clientSession
//            }
//        }
        callback(null, options);
    };

    return ExecutorClient;
});
/*
 * Copyright (C) 2014 Vanderbilt University, All rights reserved.
 *
 * Author: Zsolt Lattmann
 */


define('plugin/PluginConfig',[], function () {

    /**
     * Initializes a new instance of plugin configuration.
     *
     * Note: this object is JSON serializable see serialize method.
     *
     * @param config - deserializes an existing configuration to this object.
     * @constructor
     */
    var PluginConfig = function (config) {
        if (config) {
            var keys = Object.keys(config);
            for (var i = 0; i < keys.length; i += 1) {
                // TODO: check for type on deserialization
                this[keys[i]] = config[keys[i]];
            }
        }
    };

    /**
     * Serializes this object to a JSON representation.
     *
     * @returns {{}}
     */
    PluginConfig.prototype.serialize = function () {
        var keys = Object.keys(this);
        var result = {};

        for (var i = 0; i < keys.length; i += 1) {
            // TODO: check for type on serialization
            result[keys[i]] = this[keys[i]];
        }

        return result;
    };


    return PluginConfig;
});
/*
 * Copyright (C) 2014 Vanderbilt University, All rights reserved.
 *
 * Author: Zsolt Lattmann
 */


define('plugin/PluginNodeDescription',[], function () {

    /**
     * Initializes a new instance of plugin node description object.
     *
     * Note: this object is JSON serializable see serialize method.
     *
     * @param config - deserializes an existing configuration to this object.
     * @constructor
     */
    var PluginNodeDescription = function (config) {
        if (config) {
            this.name = config.name;
            this.id = config.id;
        } else {
            this.name = '';
            this.id = '';
        }
    };

    /**
     * Serializes this object to a JSON representation.
     *
     * @returns {{}}
     */
    PluginNodeDescription.prototype.serialize = function() {
        var keys = Object.keys(this);
        var result = {};

        for (var i = 0; i < keys.length; i += 1) {
            // TODO: check for type on serialization
            result[keys[i]] = this[keys[i]];
        }

        return result;
    };

    return PluginNodeDescription;
});
/*
 * Copyright (C) 2014 Vanderbilt University, All rights reserved.
 *
 * Author: Zsolt Lattmann
 */


define('plugin/PluginMessage',['plugin/PluginNodeDescription'], function (PluginNodeDescription) {

    /**
     * Initializes a new instance of plugin message.
     *
     * Note: this object is JSON serializable see serialize method.
     *
     * @param config - deserializes an existing configuration to this object.
     * @constructor
     */
    var PluginMessage = function (config) {
        if (config) {
            this.commitHash = config.commitHash;
            if (config.activeNode instanceof PluginNodeDescription) {
                this.activeNode = config.activeNode;
            } else {
                this.activeNode = new PluginNodeDescription(config.activeNode);
            }

            this.message = config.message;
            if (config.severity) {
                this.severity = config.severity;
            } else {
                this.severity = 'info';
            }
        } else {
            this.commitHash = '';
            this.activeNode = new PluginNodeDescription();
            this.message = '';
            this.severity = 'info';
        }
    };

    /**
     * Serializes this object to a JSON representation.
     *
     * @returns {{}}
     */
    PluginMessage.prototype.serialize = function () {
        var result = {
            commitHash: this.commitHash,
            activeNode: this.activeNode.serialize(),
            message: this.message,
            severity: this.severity
        };

        return result;
    };

    return PluginMessage;
});
/**
 * Created by zsolt on 3/20/14.
 */


define('plugin/PluginResult',['plugin/PluginMessage'], function (PluginMessage) {

    /**
     * Initializes a new instance of a plugin result object.
     *
     * Note: this object is JSON serializable see serialize method.
     *
     * @param config - deserializes an existing configuration to this object.
     * @constructor
     */
    var PluginResult = function (config) {
        if (config) {
            this.success = config.success;
            this.pluginName = config.pluginName;
            this.startTime = config.startTime;
            this.finishTime = config.finishTime;
            this.messages = [];
            this.artifacts = config.artifacts;
            this.error = config.error;

            for (var i = 0; i < config.messages.length; i += 1) {
                var pluginMessage;
                if (config.messages[i] instanceof PluginMessage) {
                    pluginMessage = config.messages[i];
                } else {
                    pluginMessage = new PluginMessage(config.messages[i]);
                }
                this.messages.push(pluginMessage);
            }
        } else {
            this.success = false;
            this.messages = []; // array of PluginMessages
            this.artifacts = []; // array of hashes
            this.pluginName = 'PluginName N/A';
            this.startTime = null;
            this.finishTime = null;
            this.error = null;
        }
    };

    /**
     * Gets the success flag of this result object
     *
     * @returns {boolean}
     */
    PluginResult.prototype.getSuccess = function () {
        return this.success;
    };

    /**
     * Sets the success flag of this result.
     *
     * @param {boolean} value
     */
    PluginResult.prototype.setSuccess = function (value) {
        this.success = value;
    };

    /**
     * Returns with the plugin messages.
     *
     * @returns {plugin.PluginMessage[]}
     */
    PluginResult.prototype.getMessages = function () {
        return this.messages;
    };

    /**
     * Adds a new plugin message to the messages list.
     *
     * @param {plugin.PluginMessage} pluginMessage
     */
    PluginResult.prototype.addMessage = function (pluginMessage) {
        this.messages.push(pluginMessage);
    };

    PluginResult.prototype.getArtifacts = function () {
        return this.artifacts;
    };

    PluginResult.prototype.addArtifact = function (hash) {
        this.artifacts.push(hash);
    };

    /**
     * Gets the name of the plugin to which the result object belongs to.
     *
     * @returns {string}
     */
    PluginResult.prototype.getPluginName = function () {
        return this.pluginName;
    };

    //------------------------------------------------------------------------------------------------------------------
    //--------------- Methods used by the plugin manager

    /**
     * Sets the name of the plugin to which the result object belongs to.
     *
     * @param pluginName - name of the plugin
     */
    PluginResult.prototype.setPluginName = function (pluginName) {
        this.pluginName = pluginName;
    };

    /**
     * Gets the ISO 8601 representation of the time when the plugin started its execution.
     *
     * @returns {string}
     */
    PluginResult.prototype.getStartTime = function () {
        return this.startTime;
    };

    /**
     * Sets the ISO 8601 representation of the time when the plugin started its execution.
     *
     * @param {string} time
     */
    PluginResult.prototype.setStartTime = function (time) {
        this.startTime = time;
    };

    /**
     * Gets the ISO 8601 representation of the time when the plugin finished its execution.
     *
     * @returns {string}
     */
    PluginResult.prototype.getFinishTime = function () {
        return this.finishTime;
    };

    /**
     * Sets the ISO 8601 representation of the time when the plugin finished its execution.
     *
     * @param {string} time
     */
    PluginResult.prototype.setFinishTime = function (time) {
        this.finishTime = time;
    };

    /**
     * Gets error if any error occured during execution.
     * FIXME: should this be an Error object?
     * @returns {string}
     */
    PluginResult.prototype.getError = function () {
        return this.error;
    };

    /**
     * Sets the error string if any error occured during execution.
     * FIXME: should this be an Error object?
     * @param {string} time
     */
    PluginResult.prototype.setError = function (error) {
        this.error = error;
    };

    /**
     * Serializes this object to a JSON representation.
     *
     * @returns {{success: boolean, messages: plugin.PluginMessage[], pluginName: string, finishTime: stirng}}
     */
    PluginResult.prototype.serialize = function () {
        var result = {
            success: this.success,
            messages: [],
            artifacts: this.artifacts,
            pluginName: this.pluginName,
            startTime: this.startTime,
            finishTime: this.finishTime,
            error: this.error
        };

        for (var i = 0; i < this.messages.length; i += 1) {
            result.messages.push(this.messages[i].serialize());
        }

        return result;
    };

    return PluginResult;
});
/*
 * Copyright (C) 2014 Vanderbilt University, All rights reserved.
 *
 * Author: Zsolt Lattmann
 */


define('plugin/PluginBase',['plugin/PluginConfig',
    'plugin/PluginResult',
    'plugin/PluginMessage',
    'plugin/PluginNodeDescription'],
    function (PluginConfig, PluginResult, PluginMessage, PluginNodeDescription) {


        /**
         * Initializes a new instance of a plugin object, which should be a derived class.
         *
         * @constructor
         */
        var PluginBase = function () {
            // set by initialize
            this.logger = null;
            this.blobClient = null;
            this._currentConfig = null;

            // set by configure
            this.core = null;
            this.project = null;
            this.projectName = null;
            this.branchName = null;
            this.branchHash = null;
            this.commitHash = null;
            this.currentHash = null;
            this.rootNode = null;
            this.activeNode = null;
            this.activeSelection = [];
            this.META = null;

            this.result = null;
            this.isConfigured = false;
        };

        //--------------------------------------------------------------------------------------------------------------
        //---------- Methods must be overridden by the derived classes

        /**
         * Main function for the plugin to execute. This will perform the execution.
         * Notes:
         * - do NOT use console.log use this.logger.[error,warning,info,debug] instead
         * - do NOT put any user interaction logic UI, etc. inside this function
         * - callback always have to be called even if error happened
         *
         * @param {function(string, plugin.PluginResult)} callback - the result callback
         */
        PluginBase.prototype.main = function (callback) {
            throw new Error('implement this function in the derived class');
        };

        /**
         * Readable name of this plugin that can contain spaces.
         *
         * @returns {string}
         */
        PluginBase.prototype.getName = function () {
            throw new Error('implement this function in the derived class - getting type automatically is a bad idea,' +
                'when the js scripts are minified names are useless.');
        };

        //--------------------------------------------------------------------------------------------------------------
        //---------- Methods could be overridden by the derived classes

        /**
         * Current version of this plugin using semantic versioning.
         * @returns {string}
         */
        PluginBase.prototype.getVersion = function () {
            return '0.1.0';
        };

        /**
         * A detailed description of this plugin and its purpose. It can be one or more sentences.
         *
         * @returns {string}
         */
        PluginBase.prototype.getDescription = function () {
            return '';
        };

        /**
         * Configuration structure with names, descriptions, minimum, maximum values, default values and
         * type definitions.
         *
         * Example:
         *
         * [{
         *    "name": "logChildrenNames",
         *    "displayName": "Log Children Names",
         *    "description": '',
         *    "value": true, // this is the 'default config'
         *    "valueType": "boolean",
         *    "readOnly": false
         * },{
         *    "name": "logLevel",
         *    "displayName": "Logger level",
         *    "description": '',
         *    "value": "info",
         *    "valueType": "string",
         *    "valueItems": [
         *          "debug",
         *          "info",
         *          "warn",
         *          "error"
         *      ],
         *    "readOnly": false
         * },{
         *    "name": "maxChildrenToLog",
         *    "displayName": "Maximum children to log",
         *    "description": 'Set this parameter to blabla',
         *    "value": 4,
         *    "minValue": 1,
         *    "valueType": "number",
         *    "readOnly": false
         * }]
         *
         * @returns {object[]}
         */
        PluginBase.prototype.getConfigStructure = function () {
            return [];
        };

        //--------------------------------------------------------------------------------------------------------------
        //---------- Methods that can be used by the derived classes

        /**
         * Updates the current success flag with a new value.
         *
         * NewValue = OldValue && Value
         *
         * @param {boolean} value - apply this flag on current success value
         * @param {string|null} message - optional detailed message
         */
        PluginBase.prototype.updateSuccess = function (value, message) {
            var prevSuccess = this.result.getSuccess();
            var newSuccessValue = prevSuccess && value;

            this.result.setSuccess(newSuccessValue);
            var msg = '';
            if (message) {
                msg = ' - ' + message;
            }

            this.logger.debug('Success was updated from ' + prevSuccess + ' to ' + newSuccessValue + msg);
        };

        /**
         * WebGME can export the META types as path and this method updates the generated domain specific types with
         * webgme node objects. These can be used to define the base class of new objects created through the webgme API.
         *
         * @param {object} generatedMETA
         */
        PluginBase.prototype.updateMETA = function (generatedMETA) {
            var name;
            for (name in this.META) {
                if (this.META.hasOwnProperty(name)) {
                    generatedMETA[name] = this.META[name];
                }
            }

            // TODO: check if names are not the same
            // TODO: log if META is out of date
        };

        /**
         * Checks if the given node is of the given meta-type.
         * Usage: <tt>self.isMetaTypeOf(aNode, self.META['FCO']);</tt>
         * @param node - Node to be checked for type.
         * @param metaNode - Node object defining the meta type.
         * @returns {boolean} - True if the given object was of the META type.
         */
        PluginBase.prototype.isMetaTypeOf = function (node, metaNode) {
            var self = this;
            while (node) {
                if (self.core.getGuid(node) === self.core.getGuid(metaNode)) {
                    return true;
                }
                node = self.core.getBase(node);
            }
            return false;
        };

        /**
         * Finds and returns the node object defining the meta type for the given node.
         * @param node - Node to be checked for type.
         * @returns {Object} - Node object defining the meta type of node.
         */
        PluginBase.prototype.getMetaType = function (node) {
            var self = this,
                name;
            while (node) {
                name = self.core.getAttribute(node, 'name');
                if (self.META.hasOwnProperty(name) && self.core.getGuid(node) === self.core.getGuid(self.META[name])) {
                    break;
                }
                node = self.core.getBase(node);
            }
            return node;
        };

        /**
         * Returns true if node is a direct instance of a meta-type node (or a meta-type node itself).
         * @param node - Node to be checked.
         * @returns {boolean}
         */
        PluginBase.prototype.baseIsMeta = function (node) {
            var self = this,
                baseName,
                baseNode = self.core.getBase(node);
            if (!baseNode) {
                // FCO does not have a base node, by definition function returns true.
                return true;
            }
            baseName = self.core.getAttribute(baseNode, 'name');
            return self.META.hasOwnProperty(baseName) && self.core.getGuid(self.META[baseName]) === self.core.getGuid(baseNode);
        };

        /**
         * Gets the current configuration of the plugin that was set by the user and plugin manager.
         *
         * @returns {object}
         */
        PluginBase.prototype.getCurrentConfig = function () {
            return this._currentConfig;
        };

        /**
         * Creates a new message for the user and adds it to the result.
         *
         * @param {object} node - webgme object which is related to the message
         * @param {string} message - feedback to the user
         * @param {string} severity - severity level of the message: 'debug', 'info' (default), 'warning', 'error'.
         */
        PluginBase.prototype.createMessage = function (node, message, severity) {
            var severityLevel = severity || 'info';
            //this occurence of the function will always handle a single node

            var descriptor = new PluginNodeDescription({
                    name: node ? this.core.getAttribute(node, 'name') : "",
                    id: node ? this.core.getPath(node) : ""
                });
            var pluginMessage = new PluginMessage({
                    commitHash: this.currentHash,
                    activeNode: descriptor,
                    message: message,
                    severity: severityLevel
                });

            this.result.addMessage(pluginMessage);
        };

        /**
         * Saves all current changes if there is any to a new commit.
         * If the changes were started from a branch, then tries to fast forward the branch to the new commit.
         * Note: Does NOT handle any merges at this point.
         *
         * @param {string|null} message - commit message
         * @param callback
         */
        PluginBase.prototype.save = function (message, callback) {
            var self = this;

            this.logger.debug('Saving project');

            this.core.persist(this.rootNode,function(err){if (err) {self.logger.error(err);}});
            var newRootHash = self.core.getHash(self.rootNode);

            var commitMessage = '[Plugin] ' + self.getName() + ' (v' + self.getVersion() + ') updated the model.';
            if (message) {
                commitMessage += ' - ' + message;
            }
            self.currentHash = self.project.makeCommit([self.currentHash], newRootHash, commitMessage, function (err) {if (err) {self.logger.error(err);}});

            if (self.branchName) {
                // try to fast forward branch if there was a branch name defined

                // FIXME: what if master branch is already in a different state?

                self.project.getBranchNames(function (err, branchNames) {
                    if (branchNames.hasOwnProperty(self.branchName)) {
                        var branchHash = branchNames[self.branchName];
                        if (branchHash === self.branchHash) {
                            // the branch does not have any new commits
                            // try to fast forward branch to the current commit
                            self.project.setBranchHash(self.branchName, self.branchHash, self.currentHash, function (err) {
                                if (err) {
                                    // fast forward failed
                                    self.logger.error(err);
                                    self.logger.info('"' + self.branchName + '" was NOT updated');
                                    self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                                } else {
                                    // successful fast forward of branch to the new commit
                                    self.logger.info('"' + self.branchName + '" was updated to the new commit.');
                                    // roll starting point on success
                                    self.branchHash = self.currentHash;
                                }
                                callback(err);
                            });
                        } else {
                            // branch has changes a merge is required
                            // TODO: try auto-merge, if fails ...
                            self.logger.warn('Cannot fast forward "' + self.branchName + '" branch. Merge is required but not supported yet.');
                            self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                            callback(null);
                        }
                    } else {
                        // branch was deleted or not found, do nothing
                        self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                        callback(null);
                    }
                });
                // FIXME: is this call async??
                // FIXME: we are not tracking all commits that we make

            } else {
                // making commits, we have not started from a branch
                self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                callback(null);
            }

            // Commit changes.
/*            this.core.persist(this.rootNode, function (err) {
                // TODO: any error here?
                if (err) {
                    self.logger.error(err);
                }

                var newRootHash = self.core.getHash(self.rootNode);

                var commitMessage = '[Plugin] ' + self.getName() + ' (v' + self.getVersion() + ') updated the model.';
                if (message) {
                    commitMessage += ' - ' + message;
                }

                self.currentHash = self.project.makeCommit([self.currentHash], newRootHash, commitMessage, function (err) {
                    // TODO: any error handling here?
                    if (err) {
                        self.logger.error(err);
                    }

                    if (self.branchName) {
                        // try to fast forward branch if there was a branch name defined

                        // FIXME: what if master branch is already in a different state?

                        self.project.getBranchNames(function (err, branchNames) {
                            if (branchNames.hasOwnProperty(self.branchName)) {
                                var branchHash = branchNames[self.branchName];
                                if (branchHash === self.branchHash) {
                                    // the branch does not have any new commits
                                    // try to fast forward branch to the current commit
                                    self.project.setBranchHash(self.branchName, self.branchHash, self.currentHash, function (err) {
                                        if (err) {
                                            // fast forward failed
                                            self.logger.error(err);
                                            self.logger.info('"' + self.branchName + '" was NOT updated');
                                            self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                                        } else {
                                            // successful fast forward of branch to the new commit
                                            self.logger.info('"' + self.branchName + '" was updated to the new commit.');
                                            // roll starting point on success
                                            self.branchHash = self.currentHash;
                                        }
                                        callback(err);
                                    });
                                } else {
                                    // branch has changes a merge is required
                                    // TODO: try auto-merge, if fails ...
                                    self.logger.warn('Cannot fast forward "' + self.branchName + '" branch. Merge is required but not supported yet.');
                                    self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                                    callback(null);
                                }
                            } else {
                                // branch was deleted or not found, do nothing
                                self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                                callback(null);
                            }
                        });
                        // FIXME: is this call async??
                        // FIXME: we are not tracking all commits that we make

                    } else {
                        // making commits, we have not started from a branch
                        self.logger.info('Project was saved to ' + self.currentHash + ' commit.');
                        callback(null);
                    }
                });

            });*/
        };

        //--------------------------------------------------------------------------------------------------------------
        //---------- Methods that are used by the Plugin Manager. Derived classes should not use these methods

        /**
         * Initializes the plugin with objects that can be reused within the same plugin instance.
         *
         * @param {logManager} logger - logging capability to console (or file) based on PluginManager configuration
         * @param {blob.BlobClient} blobClient - virtual file system where files can be generated then saved as a zip file.
         */
        PluginBase.prototype.initialize = function (logger, blobClient) {
            if (logger) {
                this.logger = logger;
            } else {
                this.logger = console;
            }

            this.blobClient = blobClient;

            this._currentConfig = null;
            // initialize default configuration
            this.setCurrentConfig(this.getDefaultConfig());

            this.isConfigured = false;
        };

        /**
         * Configures this instance of the plugin for a specific execution. This function is called before the main by
         * the PluginManager.
         * Initializes the result with a new object.
         *
         * @param {PluginContext} config - specific context: project, branch, core, active object and active selection.
         */
        PluginBase.prototype.configure = function (config) {
            this.core = config.core;
            this.project = config.project;
            this.projectName = config.projectName;
            this.branchName = config.branchName;
            this.branchHash = config.branchName ? config.commitHash : null;
            this.commitHash = config.commitHash;
            this.currentHash = config.commitHash;
            this.rootNode = config.rootNode;
            this.activeNode = config.activeNode;
            this.activeSelection = config.activeSelection;
            this.META = config.META;

            this.result = new PluginResult();


            this.isConfigured = true;
        };

        /**
         * Gets the default configuration based on the configuration structure for this plugin.
         *
         * @returns {plugin.PluginConfig}
         */
        PluginBase.prototype.getDefaultConfig = function () {
            var configStructure = this.getConfigStructure();

            var defaultConfig = new PluginConfig();

            for (var i = 0; i < configStructure.length; i += 1) {
                defaultConfig[configStructure[i].name] = configStructure[i].value;
            }

            return defaultConfig;
        };

        /**
         * Sets the current configuration of the plugin.
         *
         * @param {object} newConfig - this is the actual configuration and NOT the configuration structure.
         */
        PluginBase.prototype.setCurrentConfig = function (newConfig) {
            this._currentConfig = newConfig;
        };

        return PluginBase;
    });
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/AcmImporter/AcmImporter/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/*!

JSZip - A Javascript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2014 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/master/LICENSE.markdown.

JSZip uses the library zlib.js released under the following license :
zlib.js 2012 - imaya [ https://github.com/imaya/zlib.js ] The MIT License
*/
!function(e){"object"==typeof exports?module.exports=e():"function"==typeof define&&define.amd?define('jszip',e):"undefined"!=typeof window?window.JSZip=e():"undefined"!=typeof global?global.JSZip=e():"undefined"!=typeof self&&(self.JSZip=e())}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

// private property
var _keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";


// public method for encoding
exports.encode = function(input, utf8) {
    var output = "";
    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
    var i = 0;

    while (i < input.length) {

        chr1 = input.charCodeAt(i++);
        chr2 = input.charCodeAt(i++);
        chr3 = input.charCodeAt(i++);

        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;

        if (isNaN(chr2)) {
            enc3 = enc4 = 64;
        }
        else if (isNaN(chr3)) {
            enc4 = 64;
        }

        output = output + _keyStr.charAt(enc1) + _keyStr.charAt(enc2) + _keyStr.charAt(enc3) + _keyStr.charAt(enc4);

    }

    return output;
};

// public method for decoding
exports.decode = function(input, utf8) {
    var output = "";
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;

    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

    while (i < input.length) {

        enc1 = _keyStr.indexOf(input.charAt(i++));
        enc2 = _keyStr.indexOf(input.charAt(i++));
        enc3 = _keyStr.indexOf(input.charAt(i++));
        enc4 = _keyStr.indexOf(input.charAt(i++));

        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;

        output = output + String.fromCharCode(chr1);

        if (enc3 != 64) {
            output = output + String.fromCharCode(chr2);
        }
        if (enc4 != 64) {
            output = output + String.fromCharCode(chr3);
        }

    }

    return output;

};

},{}],2:[function(require,module,exports){

function CompressedObject() {
    this.compressedSize = 0;
    this.uncompressedSize = 0;
    this.crc32 = 0;
    this.compressionMethod = null;
    this.compressedContent = null;
}

CompressedObject.prototype = {
    /**
     * Return the decompressed content in an unspecified format.
     * The format will depend on the decompressor.
     * @return {Object} the decompressed content.
     */
    getContent: function() {
        return null; // see implementation
    },
    /**
     * Return the compressed content in an unspecified format.
     * The format will depend on the compressed conten source.
     * @return {Object} the compressed content.
     */
    getCompressedContent: function() {
        return null; // see implementation
    }
};
module.exports = CompressedObject;

},{}],3:[function(require,module,exports){

exports.STORE = {
    magic: "\x00\x00",
    compress: function(content) {
        return content; // no compression
    },
    uncompress: function(content) {
        return content; // no compression
    },
    compressInputType: null,
    uncompressInputType: null
};
exports.DEFLATE = require('./flate');

},{"./flate":6}],4:[function(require,module,exports){

var utils = require('./utils');

function DataReader(data) {
    this.data = null; // type : see implementation
    this.length = 0;
    this.index = 0;
}
DataReader.prototype = {
    /**
     * Check that the offset will not go too far.
     * @param {string} offset the additional offset to check.
     * @throws {Error} an Error if the offset is out of bounds.
     */
    checkOffset: function(offset) {
        this.checkIndex(this.index + offset);
    },
    /**
     * Check that the specifed index will not be too far.
     * @param {string} newIndex the index to check.
     * @throws {Error} an Error if the index is out of bounds.
     */
    checkIndex: function(newIndex) {
        if (this.length < newIndex || newIndex < 0) {
            throw new Error("End of data reached (data length = " + this.length + ", asked index = " + (newIndex) + "). Corrupted zip ?");
        }
    },
    /**
     * Change the index.
     * @param {number} newIndex The new index.
     * @throws {Error} if the new index is out of the data.
     */
    setIndex: function(newIndex) {
        this.checkIndex(newIndex);
        this.index = newIndex;
    },
    /**
     * Skip the next n bytes.
     * @param {number} n the number of bytes to skip.
     * @throws {Error} if the new index is out of the data.
     */
    skip: function(n) {
        this.setIndex(this.index + n);
    },
    /**
     * Get the byte at the specified index.
     * @param {number} i the index to use.
     * @return {number} a byte.
     */
    byteAt: function(i) {
        // see implementations
    },
    /**
     * Get the next number with a given byte size.
     * @param {number} size the number of bytes to read.
     * @return {number} the corresponding number.
     */
    readInt: function(size) {
        var result = 0,
            i;
        this.checkOffset(size);
        for (i = this.index + size - 1; i >= this.index; i--) {
            result = (result << 8) + this.byteAt(i);
        }
        this.index += size;
        return result;
    },
    /**
     * Get the next string with a given byte size.
     * @param {number} size the number of bytes to read.
     * @return {string} the corresponding string.
     */
    readString: function(size) {
        return utils.transformTo("string", this.readData(size));
    },
    /**
     * Get raw data without conversion, <size> bytes.
     * @param {number} size the number of bytes to read.
     * @return {Object} the raw data, implementation specific.
     */
    readData: function(size) {
        // see implementations
    },
    /**
     * Find the last occurence of a zip signature (4 bytes).
     * @param {string} sig the signature to find.
     * @return {number} the index of the last occurence, -1 if not found.
     */
    lastIndexOfSignature: function(sig) {
        // see implementations
    },
    /**
     * Get the next date.
     * @return {Date} the date.
     */
    readDate: function() {
        var dostime = this.readInt(4);
        return new Date(
        ((dostime >> 25) & 0x7f) + 1980, // year
        ((dostime >> 21) & 0x0f) - 1, // month
        (dostime >> 16) & 0x1f, // day
        (dostime >> 11) & 0x1f, // hour
        (dostime >> 5) & 0x3f, // minute
        (dostime & 0x1f) << 1); // second
    }
};
module.exports = DataReader;

},{"./utils":14}],5:[function(require,module,exports){

exports.base64 = false;
exports.binary = false;
exports.dir = false;
exports.date = null;
exports.compression = null;

},{}],6:[function(require,module,exports){

var USE_TYPEDARRAY = (typeof Uint8Array !== 'undefined') && (typeof Uint16Array !== 'undefined') && (typeof Uint32Array !== 'undefined');

var  ZlibDeflate = require('zlibjs/bin/rawdeflate.min').Zlib;
var  ZlibInflate = require('zlibjs/bin/rawinflate.min').Zlib;
exports.uncompressInputType = USE_TYPEDARRAY ? "uint8array" : "array";
exports.compressInputType = USE_TYPEDARRAY ? "uint8array" : "array";

exports.magic = "\x08\x00";
exports.compress = function(input) {
    var deflate = new ZlibDeflate.RawDeflate(input);
    return deflate.compress();
};
exports.uncompress =  function(input) {
    var inflate = new ZlibInflate.RawInflate(input);
    return inflate.decompress();
};

},{"zlibjs/bin/rawdeflate.min":19,"zlibjs/bin/rawinflate.min":20}],7:[function(require,module,exports){

/**
Usage:
   zip = new JSZip();
   zip.file("hello.txt", "Hello, World!").file("tempfile", "nothing");
   zip.folder("images").file("smile.gif", base64Data, {base64: true});
   zip.file("Xmas.txt", "Ho ho ho !", {date : new Date("December 25, 2007 00:00:01")});
   zip.remove("tempfile");

   base64zip = zip.generate();

**/

/**
 * Representation a of zip file in js
 * @constructor
 * @param {String=|ArrayBuffer=|Uint8Array=} data the data to load, if any (optional).
 * @param {Object=} options the options for creating this objects (optional).
 */
function JSZip(data, options) {
    // if this constructor is used without `new`, it adds `new` before itself:
    if(!(this instanceof JSZip)) return new JSZip(data, options);
    
    // object containing the files :
    // {
    //   "folder/" : {...},
    //   "folder/data.txt" : {...}
    // }
    this.files = {};

    // Where we are in the hierarchy
    this.root = "";
    if (data) {
        this.load(data, options);
    }
    this.clone = function() {
        var newObj = new JSZip();
        for (var i in this) {
            if (typeof this[i] !== "function") {
                newObj[i] = this[i];
            }
        }
        return newObj;
    };
}
JSZip.prototype = require('./object');
JSZip.prototype.load = require('./load');
JSZip.support = require('./support');
JSZip.defaults = require('./defaults');
JSZip.utils = require('./utils');
JSZip.base64 = require('./base64');
JSZip.compressions = require('./compressions');
module.exports = JSZip;

},{"./base64":1,"./compressions":3,"./defaults":5,"./load":8,"./object":9,"./support":12,"./utils":14}],8:[function(require,module,exports){

var base64 = require('./base64');
var ZipEntries = require('./zipEntries');
module.exports = function(data, options) {
    var files, zipEntries, i, input;
    options = options || {};
    if (options.base64) {
        data = base64.decode(data);
    }

    zipEntries = new ZipEntries(data, options);
    files = zipEntries.files;
    for (i = 0; i < files.length; i++) {
        input = files[i];
        this.file(input.fileName, input.decompressed, {
            binary: true,
            optimizedBinaryString: true,
            date: input.date,
            dir: input.dir
        });
    }

    return this;
};

},{"./base64":1,"./zipEntries":15}],9:[function(require,module,exports){

var support = require('./support');
var utils = require('./utils');
var signature = require('./signature');
var defaults = require('./defaults');
var base64 = require('./base64');
var compressions = require('./compressions');
var CompressedObject = require('./compressedObject');
var nodeBuffer = require('./nodeBuffer');
/**
 * Returns the raw data of a ZipObject, decompress the content if necessary.
 * @param {ZipObject} file the file to use.
 * @return {String|ArrayBuffer|Uint8Array|Buffer} the data.
 */

var textEncoder, textDecoder;
if (
    support.uint8array &&
    typeof TextEncoder === "function" &&
    typeof TextDecoder === "function"
) {
    textEncoder = new TextEncoder("utf-8");
    textDecoder = new TextDecoder("utf-8");
}

var getRawData = function(file) {
    if (file._data instanceof CompressedObject) {
        file._data = file._data.getContent();
        file.options.binary = true;
        file.options.base64 = false;

        if (utils.getTypeOf(file._data) === "uint8array") {
            var copy = file._data;
            // when reading an arraybuffer, the CompressedObject mechanism will keep it and subarray() a Uint8Array.
            // if we request a file in the same format, we might get the same Uint8Array or its ArrayBuffer (the original zip file).
            file._data = new Uint8Array(copy.length);
            // with an empty Uint8Array, Opera fails with a "Offset larger than array size"
            if (copy.length !== 0) {
                file._data.set(copy, 0);
            }
        }
    }
    return file._data;
};

/**
 * Returns the data of a ZipObject in a binary form. If the content is an unicode string, encode it.
 * @param {ZipObject} file the file to use.
 * @return {String|ArrayBuffer|Uint8Array|Buffer} the data.
 */
var getBinaryData = function(file) {
    var result = getRawData(file),
        type = utils.getTypeOf(result);
    if (type === "string") {
        if (!file.options.binary) {
            // unicode text !
            // unicode string => binary string is a painful process, check if we can avoid it.
            if (textEncoder) {
                return textEncoder.encode(result);
            }
            if (support.nodebuffer) {
                return nodeBuffer(result, "utf-8");
            }
        }
        return file.asBinary();
    }
    return result;
};

/**
 * Transform this._data into a string.
 * @param {function} filter a function String -> String, applied if not null on the result.
 * @return {String} the string representing this._data.
 */
var dataToString = function(asUTF8) {
    var result = getRawData(this);
    if (result === null || typeof result === "undefined") {
        return "";
    }
    // if the data is a base64 string, we decode it before checking the encoding !
    if (this.options.base64) {
        result = base64.decode(result);
    }
    if (asUTF8 && this.options.binary) {
        // JSZip.prototype.utf8decode supports arrays as input
        // skip to array => string step, utf8decode will do it.
        result = out.utf8decode(result);
    }
    else {
        // no utf8 transformation, do the array => string step.
        result = utils.transformTo("string", result);
    }

    if (!asUTF8 && !this.options.binary) {
        result = out.utf8encode(result);
    }
    return result;
};
/**
 * A simple object representing a file in the zip file.
 * @constructor
 * @param {string} name the name of the file
 * @param {String|ArrayBuffer|Uint8Array|Buffer} data the data
 * @param {Object} options the options of the file
 */
var ZipObject = function(name, data, options) {
    this.name = name;
    this._data = data;
    this.options = options;
};

ZipObject.prototype = {
    /**
     * Return the content as UTF8 string.
     * @return {string} the UTF8 string.
     */
    asText: function() {
        return dataToString.call(this, true);
    },
    /**
     * Returns the binary content.
     * @return {string} the content as binary.
     */
    asBinary: function() {
        return dataToString.call(this, false);
    },
    /**
     * Returns the content as a nodejs Buffer.
     * @return {Buffer} the content as a Buffer.
     */
    asNodeBuffer: function() {
        var result = getBinaryData(this);
        return utils.transformTo("nodebuffer", result);
    },
    /**
     * Returns the content as an Uint8Array.
     * @return {Uint8Array} the content as an Uint8Array.
     */
    asUint8Array: function() {
        var result = getBinaryData(this);
        return utils.transformTo("uint8array", result);
    },
    /**
     * Returns the content as an ArrayBuffer.
     * @return {ArrayBuffer} the content as an ArrayBufer.
     */
    asArrayBuffer: function() {
        return this.asUint8Array().buffer;
    }
};

/**
 * Transform an integer into a string in hexadecimal.
 * @private
 * @param {number} dec the number to convert.
 * @param {number} bytes the number of bytes to generate.
 * @returns {string} the result.
 */
var decToHex = function(dec, bytes) {
    var hex = "",
        i;
    for (i = 0; i < bytes; i++) {
        hex += String.fromCharCode(dec & 0xff);
        dec = dec >>> 8;
    }
    return hex;
};

/**
 * Merge the objects passed as parameters into a new one.
 * @private
 * @param {...Object} var_args All objects to merge.
 * @return {Object} a new object with the data of the others.
 */
var extend = function() {
    var result = {}, i, attr;
    for (i = 0; i < arguments.length; i++) { // arguments is not enumerable in some browsers
        for (attr in arguments[i]) {
            if (arguments[i].hasOwnProperty(attr) && typeof result[attr] === "undefined") {
                result[attr] = arguments[i][attr];
            }
        }
    }
    return result;
};

/**
 * Transforms the (incomplete) options from the user into the complete
 * set of options to create a file.
 * @private
 * @param {Object} o the options from the user.
 * @return {Object} the complete set of options.
 */
var prepareFileAttrs = function(o) {
    o = o || {};
    if (o.base64 === true && (o.binary === null || o.binary === undefined)) {
        o.binary = true;
    }
    o = extend(o, defaults);
    o.date = o.date || new Date();
    if (o.compression !== null) o.compression = o.compression.toUpperCase();

    return o;
};

/**
 * Add a file in the current folder.
 * @private
 * @param {string} name the name of the file
 * @param {String|ArrayBuffer|Uint8Array|Buffer} data the data of the file
 * @param {Object} o the options of the file
 * @return {Object} the new file.
 */
var fileAdd = function(name, data, o) {
    // be sure sub folders exist
    var parent = parentFolder(name),
        dataType = utils.getTypeOf(data);
    if (parent) {
        folderAdd.call(this, parent);
    }

    o = prepareFileAttrs(o);

    if (o.dir || data === null || typeof data === "undefined") {
        o.base64 = false;
        o.binary = false;
        data = null;
    }
    else if (dataType === "string") {
        if (o.binary && !o.base64) {
            // optimizedBinaryString == true means that the file has already been filtered with a 0xFF mask
            if (o.optimizedBinaryString !== true) {
                // this is a string, not in a base64 format.
                // Be sure that this is a correct "binary string"
                data = utils.string2binary(data);
            }
        }
    }
    else { // arraybuffer, uint8array, ...
        o.base64 = false;
        o.binary = true;

        if (!dataType && !(data instanceof CompressedObject)) {
            throw new Error("The data of '" + name + "' is in an unsupported format !");
        }

        // special case : it's way easier to work with Uint8Array than with ArrayBuffer
        if (dataType === "arraybuffer") {
            data = utils.transformTo("uint8array", data);
        }
    }

    var object = new ZipObject(name, data, o);
    this.files[name] = object;
    return object;
};


/**
 * Find the parent folder of the path.
 * @private
 * @param {string} path the path to use
 * @return {string} the parent folder, or ""
 */
var parentFolder = function(path) {
    if (path.slice(-1) == '/') {
        path = path.substring(0, path.length - 1);
    }
    var lastSlash = path.lastIndexOf('/');
    return (lastSlash > 0) ? path.substring(0, lastSlash) : "";
};

/**
 * Add a (sub) folder in the current folder.
 * @private
 * @param {string} name the folder's name
 * @return {Object} the new folder.
 */
var folderAdd = function(name) {
    // Check the name ends with a /
    if (name.slice(-1) != "/") {
        name += "/"; // IE doesn't like substr(-1)
    }

    // Does this folder already exist?
    if (!this.files[name]) {
        fileAdd.call(this, name, null, {
            dir: true
        });
    }
    return this.files[name];
};

/**
 * Generate a JSZip.CompressedObject for a given zipOject.
 * @param {ZipObject} file the object to read.
 * @param {JSZip.compression} compression the compression to use.
 * @return {JSZip.CompressedObject} the compressed result.
 */
var generateCompressedObjectFrom = function(file, compression) {
    var result = new CompressedObject(),
        content;

    // the data has not been decompressed, we might reuse things !
    if (file._data instanceof CompressedObject) {
        result.uncompressedSize = file._data.uncompressedSize;
        result.crc32 = file._data.crc32;

        if (result.uncompressedSize === 0 || file.options.dir) {
            compression = compressions['STORE'];
            result.compressedContent = "";
            result.crc32 = 0;
        }
        else if (file._data.compressionMethod === compression.magic) {
            result.compressedContent = file._data.getCompressedContent();
        }
        else {
            content = file._data.getContent();
            // need to decompress / recompress
            result.compressedContent = compression.compress(utils.transformTo(compression.compressInputType, content));
        }
    }
    else {
        // have uncompressed data
        content = getBinaryData(file);
        if (!content || content.length === 0 || file.options.dir) {
            compression = compressions['STORE'];
            content = "";
        }
        result.uncompressedSize = content.length;
        result.crc32 = this.crc32(content);
        result.compressedContent = compression.compress(utils.transformTo(compression.compressInputType, content));
    }

    result.compressedSize = result.compressedContent.length;
    result.compressionMethod = compression.magic;

    return result;
};

/**
 * Generate the various parts used in the construction of the final zip file.
 * @param {string} name the file name.
 * @param {ZipObject} file the file content.
 * @param {JSZip.CompressedObject} compressedObject the compressed object.
 * @param {number} offset the current offset from the start of the zip file.
 * @return {object} the zip parts.
 */
var generateZipParts = function(name, file, compressedObject, offset) {
    var data = compressedObject.compressedContent,
        utfEncodedFileName = this.utf8encode(file.name),
        useUTF8 = utfEncodedFileName !== file.name,
        o = file.options,
        dosTime,
        dosDate,
        extraFields = "",
        unicodePathExtraField = "";

    // date
    // @see http://www.delorie.com/djgpp/doc/rbinter/it/52/13.html
    // @see http://www.delorie.com/djgpp/doc/rbinter/it/65/16.html
    // @see http://www.delorie.com/djgpp/doc/rbinter/it/66/16.html

    dosTime = o.date.getHours();
    dosTime = dosTime << 6;
    dosTime = dosTime | o.date.getMinutes();
    dosTime = dosTime << 5;
    dosTime = dosTime | o.date.getSeconds() / 2;

    dosDate = o.date.getFullYear() - 1980;
    dosDate = dosDate << 4;
    dosDate = dosDate | (o.date.getMonth() + 1);
    dosDate = dosDate << 5;
    dosDate = dosDate | o.date.getDate();

    if (useUTF8) {
        // set the unicode path extra field. unzip needs at least one extra
        // field to correctly handle unicode path, so using the path is as good
        // as any other information. This could improve the situation with
        // other archive managers too.
        // This field is usually used without the utf8 flag, with a non
        // unicode path in the header (winrar, winzip). This helps (a bit)
        // with the messy Windows' default compressed folders feature but
        // breaks on p7zip which doesn't seek the unicode path extra field.
        // So for now, UTF-8 everywhere !
        unicodePathExtraField =
            // Version
            decToHex(1, 1) +
            // NameCRC32
            decToHex(this.crc32(utfEncodedFileName), 4) +
            // UnicodeName
            utfEncodedFileName;

        extraFields +=
            // Info-ZIP Unicode Path Extra Field
            "\x75\x70" +
            // size
            decToHex(unicodePathExtraField.length, 2) +
            // content
            unicodePathExtraField;
    }

    var header = "";

    // version needed to extract
    header += "\x0A\x00";
    // general purpose bit flag
    // set bit 11 if utf8
    header += useUTF8 ? "\x00\x08" : "\x00\x00";
    // compression method
    header += compressedObject.compressionMethod;
    // last mod file time
    header += decToHex(dosTime, 2);
    // last mod file date
    header += decToHex(dosDate, 2);
    // crc-32
    header += decToHex(compressedObject.crc32, 4);
    // compressed size
    header += decToHex(compressedObject.compressedSize, 4);
    // uncompressed size
    header += decToHex(compressedObject.uncompressedSize, 4);
    // file name length
    header += decToHex(utfEncodedFileName.length, 2);
    // extra field length
    header += decToHex(extraFields.length, 2);


    var fileRecord = signature.LOCAL_FILE_HEADER + header + utfEncodedFileName + extraFields;

    var dirRecord = signature.CENTRAL_FILE_HEADER +
    // version made by (00: DOS)
    "\x14\x00" +
    // file header (common to file and central directory)
    header +
    // file comment length
    "\x00\x00" +
    // disk number start
    "\x00\x00" +
    // internal file attributes TODO
    "\x00\x00" +
    // external file attributes
    (file.options.dir === true ? "\x10\x00\x00\x00" : "\x00\x00\x00\x00") +
    // relative offset of local header
    decToHex(offset, 4) +
    // file name
    utfEncodedFileName +
    // extra field
    extraFields;


    return {
        fileRecord: fileRecord,
        dirRecord: dirRecord,
        compressedObject: compressedObject
    };
};

/**
 * An object to write any content to a string.
 * @constructor
 */
var StringWriter = function() {
    this.data = [];
};
StringWriter.prototype = {
    /**
     * Append any content to the current string.
     * @param {Object} input the content to add.
     */
    append: function(input) {
        input = utils.transformTo("string", input);
        this.data.push(input);
    },
    /**
     * Finalize the construction an return the result.
     * @return {string} the generated string.
     */
    finalize: function() {
        return this.data.join("");
    }
};
/**
 * An object to write any content to an Uint8Array.
 * @constructor
 * @param {number} length The length of the array.
 */
var Uint8ArrayWriter = function(length) {
    this.data = new Uint8Array(length);
    this.index = 0;
};
Uint8ArrayWriter.prototype = {
    /**
     * Append any content to the current array.
     * @param {Object} input the content to add.
     */
    append: function(input) {
        if (input.length !== 0) {
            // with an empty Uint8Array, Opera fails with a "Offset larger than array size"
            input = utils.transformTo("uint8array", input);
            this.data.set(input, this.index);
            this.index += input.length;
        }
    },
    /**
     * Finalize the construction an return the result.
     * @return {Uint8Array} the generated array.
     */
    finalize: function() {
        return this.data;
    }
};

// return the actual prototype of JSZip
var out = {
    /**
     * Read an existing zip and merge the data in the current JSZip object.
     * The implementation is in jszip-load.js, don't forget to include it.
     * @param {String|ArrayBuffer|Uint8Array|Buffer} stream  The stream to load
     * @param {Object} options Options for loading the stream.
     *  options.base64 : is the stream in base64 ? default : false
     * @return {JSZip} the current JSZip object
     */
    load: function(stream, options) {
        throw new Error("Load method is not defined. Is the file jszip-load.js included ?");
    },

    /**
     * Filter nested files/folders with the specified function.
     * @param {Function} search the predicate to use :
     * function (relativePath, file) {...}
     * It takes 2 arguments : the relative path and the file.
     * @return {Array} An array of matching elements.
     */
    filter: function(search) {
        var result = [],
            filename, relativePath, file, fileClone;
        for (filename in this.files) {
            if (!this.files.hasOwnProperty(filename)) {
                continue;
            }
            file = this.files[filename];
            // return a new object, don't let the user mess with our internal objects :)
            fileClone = new ZipObject(file.name, file._data, extend(file.options));
            relativePath = filename.slice(this.root.length, filename.length);
            if (filename.slice(0, this.root.length) === this.root && // the file is in the current root
            search(relativePath, fileClone)) { // and the file matches the function
                result.push(fileClone);
            }
        }
        return result;
    },

    /**
     * Add a file to the zip file, or search a file.
     * @param   {string|RegExp} name The name of the file to add (if data is defined),
     * the name of the file to find (if no data) or a regex to match files.
     * @param   {String|ArrayBuffer|Uint8Array|Buffer} data  The file data, either raw or base64 encoded
     * @param   {Object} o     File options
     * @return  {JSZip|Object|Array} this JSZip object (when adding a file),
     * a file (when searching by string) or an array of files (when searching by regex).
     */
    file: function(name, data, o) {
        if (arguments.length === 1) {
            if (utils.isRegExp(name)) {
                var regexp = name;
                return this.filter(function(relativePath, file) {
                    return !file.options.dir && regexp.test(relativePath);
                });
            }
            else { // text
                return this.filter(function(relativePath, file) {
                    return !file.options.dir && relativePath === name;
                })[0] || null;
            }
        }
        else { // more than one argument : we have data !
            name = this.root + name;
            fileAdd.call(this, name, data, o);
        }
        return this;
    },

    /**
     * Add a directory to the zip file, or search.
     * @param   {String|RegExp} arg The name of the directory to add, or a regex to search folders.
     * @return  {JSZip} an object with the new directory as the root, or an array containing matching folders.
     */
    folder: function(arg) {
        if (!arg) {
            return this;
        }

        if (utils.isRegExp(arg)) {
            return this.filter(function(relativePath, file) {
                return file.options.dir && arg.test(relativePath);
            });
        }

        // else, name is a new folder
        var name = this.root + arg;
        var newFolder = folderAdd.call(this, name);

        // Allow chaining by returning a new object with this folder as the root
        var ret = this.clone();
        ret.root = newFolder.name;
        return ret;
    },

    /**
     * Delete a file, or a directory and all sub-files, from the zip
     * @param {string} name the name of the file to delete
     * @return {JSZip} this JSZip object
     */
    remove: function(name) {
        name = this.root + name;
        var file = this.files[name];
        if (!file) {
            // Look for any folders
            if (name.slice(-1) != "/") {
                name += "/";
            }
            file = this.files[name];
        }

        if (file) {
            if (!file.options.dir) {
                // file
                delete this.files[name];
            }
            else {
                // folder
                var kids = this.filter(function(relativePath, file) {
                    return file.name.slice(0, name.length) === name;
                });
                for (var i = 0; i < kids.length; i++) {
                    delete this.files[kids[i].name];
                }
            }
        }

        return this;
    },

    /**
     * Generate the complete zip file
     * @param {Object} options the options to generate the zip file :
     * - base64, (deprecated, use type instead) true to generate base64.
     * - compression, "STORE" by default.
     * - type, "base64" by default. Values are : string, base64, uint8array, arraybuffer, blob.
     * @return {String|Uint8Array|ArrayBuffer|Buffer|Blob} the zip file
     */
    generate: function(options) {
        options = extend(options || {}, {
            base64: true,
            compression: "STORE",
            type: "base64"
        });

        utils.checkSupport(options.type);

        var zipData = [],
            localDirLength = 0,
            centralDirLength = 0,
            writer, i;


        // first, generate all the zip parts.
        for (var name in this.files) {
            if (!this.files.hasOwnProperty(name)) {
                continue;
            }
            var file = this.files[name];

            var compressionName = file.options.compression || options.compression.toUpperCase();
            var compression = compressions[compressionName];
            if (!compression) {
                throw new Error(compressionName + " is not a valid compression method !");
            }

            var compressedObject = generateCompressedObjectFrom.call(this, file, compression);

            var zipPart = generateZipParts.call(this, name, file, compressedObject, localDirLength);
            localDirLength += zipPart.fileRecord.length + compressedObject.compressedSize;
            centralDirLength += zipPart.dirRecord.length;
            zipData.push(zipPart);
        }

        var dirEnd = "";

        // end of central dir signature
        dirEnd = signature.CENTRAL_DIRECTORY_END +
        // number of this disk
        "\x00\x00" +
        // number of the disk with the start of the central directory
        "\x00\x00" +
        // total number of entries in the central directory on this disk
        decToHex(zipData.length, 2) +
        // total number of entries in the central directory
        decToHex(zipData.length, 2) +
        // size of the central directory   4 bytes
        decToHex(centralDirLength, 4) +
        // offset of start of central directory with respect to the starting disk number
        decToHex(localDirLength, 4) +
        // .ZIP file comment length
        "\x00\x00";


        // we have all the parts (and the total length)
        // time to create a writer !
        var typeName = options.type.toLowerCase();
        if(typeName==="uint8array"||typeName==="arraybuffer"||typeName==="blob"||typeName==="nodebuffer") {
            writer = new Uint8ArrayWriter(localDirLength + centralDirLength + dirEnd.length);
        }else{
            writer = new StringWriter(localDirLength + centralDirLength + dirEnd.length);
        }

        for (i = 0; i < zipData.length; i++) {
            writer.append(zipData[i].fileRecord);
            writer.append(zipData[i].compressedObject.compressedContent);
        }
        for (i = 0; i < zipData.length; i++) {
            writer.append(zipData[i].dirRecord);
        }

        writer.append(dirEnd);

        var zip = writer.finalize();



        switch(options.type.toLowerCase()) {
            // case "zip is an Uint8Array"
            case "uint8array" :
            case "arraybuffer" :
            case "nodebuffer" :
               return utils.transformTo(options.type.toLowerCase(), zip);
            case "blob" :
               return utils.arrayBuffer2Blob(utils.transformTo("arraybuffer", zip));
            // case "zip is a string"
            case "base64" :
               return (options.base64) ? base64.encode(zip) : zip;
            default : // case "string" :
               return zip;
         }
      
    },

    /**
     *
     *  Javascript crc32
     *  http://www.webtoolkit.info/
     *
     */
    crc32: function crc32(input, crc) {
        if (typeof input === "undefined" || !input.length) {
            return 0;
        }

        var isArray = utils.getTypeOf(input) !== "string";

        var table = [
        0x00000000, 0x77073096, 0xEE0E612C, 0x990951BA,
        0x076DC419, 0x706AF48F, 0xE963A535, 0x9E6495A3,
        0x0EDB8832, 0x79DCB8A4, 0xE0D5E91E, 0x97D2D988,
        0x09B64C2B, 0x7EB17CBD, 0xE7B82D07, 0x90BF1D91,
        0x1DB71064, 0x6AB020F2, 0xF3B97148, 0x84BE41DE,
        0x1ADAD47D, 0x6DDDE4EB, 0xF4D4B551, 0x83D385C7,
        0x136C9856, 0x646BA8C0, 0xFD62F97A, 0x8A65C9EC,
        0x14015C4F, 0x63066CD9, 0xFA0F3D63, 0x8D080DF5,
        0x3B6E20C8, 0x4C69105E, 0xD56041E4, 0xA2677172,
        0x3C03E4D1, 0x4B04D447, 0xD20D85FD, 0xA50AB56B,
        0x35B5A8FA, 0x42B2986C, 0xDBBBC9D6, 0xACBCF940,
        0x32D86CE3, 0x45DF5C75, 0xDCD60DCF, 0xABD13D59,
        0x26D930AC, 0x51DE003A, 0xC8D75180, 0xBFD06116,
        0x21B4F4B5, 0x56B3C423, 0xCFBA9599, 0xB8BDA50F,
        0x2802B89E, 0x5F058808, 0xC60CD9B2, 0xB10BE924,
        0x2F6F7C87, 0x58684C11, 0xC1611DAB, 0xB6662D3D,
        0x76DC4190, 0x01DB7106, 0x98D220BC, 0xEFD5102A,
        0x71B18589, 0x06B6B51F, 0x9FBFE4A5, 0xE8B8D433,
        0x7807C9A2, 0x0F00F934, 0x9609A88E, 0xE10E9818,
        0x7F6A0DBB, 0x086D3D2D, 0x91646C97, 0xE6635C01,
        0x6B6B51F4, 0x1C6C6162, 0x856530D8, 0xF262004E,
        0x6C0695ED, 0x1B01A57B, 0x8208F4C1, 0xF50FC457,
        0x65B0D9C6, 0x12B7E950, 0x8BBEB8EA, 0xFCB9887C,
        0x62DD1DDF, 0x15DA2D49, 0x8CD37CF3, 0xFBD44C65,
        0x4DB26158, 0x3AB551CE, 0xA3BC0074, 0xD4BB30E2,
        0x4ADFA541, 0x3DD895D7, 0xA4D1C46D, 0xD3D6F4FB,
        0x4369E96A, 0x346ED9FC, 0xAD678846, 0xDA60B8D0,
        0x44042D73, 0x33031DE5, 0xAA0A4C5F, 0xDD0D7CC9,
        0x5005713C, 0x270241AA, 0xBE0B1010, 0xC90C2086,
        0x5768B525, 0x206F85B3, 0xB966D409, 0xCE61E49F,
        0x5EDEF90E, 0x29D9C998, 0xB0D09822, 0xC7D7A8B4,
        0x59B33D17, 0x2EB40D81, 0xB7BD5C3B, 0xC0BA6CAD,
        0xEDB88320, 0x9ABFB3B6, 0x03B6E20C, 0x74B1D29A,
        0xEAD54739, 0x9DD277AF, 0x04DB2615, 0x73DC1683,
        0xE3630B12, 0x94643B84, 0x0D6D6A3E, 0x7A6A5AA8,
        0xE40ECF0B, 0x9309FF9D, 0x0A00AE27, 0x7D079EB1,
        0xF00F9344, 0x8708A3D2, 0x1E01F268, 0x6906C2FE,
        0xF762575D, 0x806567CB, 0x196C3671, 0x6E6B06E7,
        0xFED41B76, 0x89D32BE0, 0x10DA7A5A, 0x67DD4ACC,
        0xF9B9DF6F, 0x8EBEEFF9, 0x17B7BE43, 0x60B08ED5,
        0xD6D6A3E8, 0xA1D1937E, 0x38D8C2C4, 0x4FDFF252,
        0xD1BB67F1, 0xA6BC5767, 0x3FB506DD, 0x48B2364B,
        0xD80D2BDA, 0xAF0A1B4C, 0x36034AF6, 0x41047A60,
        0xDF60EFC3, 0xA867DF55, 0x316E8EEF, 0x4669BE79,
        0xCB61B38C, 0xBC66831A, 0x256FD2A0, 0x5268E236,
        0xCC0C7795, 0xBB0B4703, 0x220216B9, 0x5505262F,
        0xC5BA3BBE, 0xB2BD0B28, 0x2BB45A92, 0x5CB36A04,
        0xC2D7FFA7, 0xB5D0CF31, 0x2CD99E8B, 0x5BDEAE1D,
        0x9B64C2B0, 0xEC63F226, 0x756AA39C, 0x026D930A,
        0x9C0906A9, 0xEB0E363F, 0x72076785, 0x05005713,
        0x95BF4A82, 0xE2B87A14, 0x7BB12BAE, 0x0CB61B38,
        0x92D28E9B, 0xE5D5BE0D, 0x7CDCEFB7, 0x0BDBDF21,
        0x86D3D2D4, 0xF1D4E242, 0x68DDB3F8, 0x1FDA836E,
        0x81BE16CD, 0xF6B9265B, 0x6FB077E1, 0x18B74777,
        0x88085AE6, 0xFF0F6A70, 0x66063BCA, 0x11010B5C,
        0x8F659EFF, 0xF862AE69, 0x616BFFD3, 0x166CCF45,
        0xA00AE278, 0xD70DD2EE, 0x4E048354, 0x3903B3C2,
        0xA7672661, 0xD06016F7, 0x4969474D, 0x3E6E77DB,
        0xAED16A4A, 0xD9D65ADC, 0x40DF0B66, 0x37D83BF0,
        0xA9BCAE53, 0xDEBB9EC5, 0x47B2CF7F, 0x30B5FFE9,
        0xBDBDF21C, 0xCABAC28A, 0x53B39330, 0x24B4A3A6,
        0xBAD03605, 0xCDD70693, 0x54DE5729, 0x23D967BF,
        0xB3667A2E, 0xC4614AB8, 0x5D681B02, 0x2A6F2B94,
        0xB40BBE37, 0xC30C8EA1, 0x5A05DF1B, 0x2D02EF8D];

        if (typeof(crc) == "undefined") {
            crc = 0;
        }
        var x = 0;
        var y = 0;
        var b = 0;

        crc = crc ^ (-1);
        for (var i = 0, iTop = input.length; i < iTop; i++) {
            b = isArray ? input[i] : input.charCodeAt(i);
            y = (crc ^ b) & 0xFF;
            x = table[y];
            crc = (crc >>> 8) ^ x;
        }

        return crc ^ (-1);
    },

    // Inspired by http://my.opera.com/GreyWyvern/blog/show.dml/1725165

    /**
     * http://www.webtoolkit.info/javascript-utf8.html
     */
    utf8encode: function(string) {
        // TextEncoder + Uint8Array to binary string is faster than checking every bytes on long strings.
        // http://jsperf.com/utf8encode-vs-textencoder
        // On short strings (file names for example), the TextEncoder API is (currently) slower.
        if (textEncoder) {
            var u8 = textEncoder.encode(string);
            return utils.transformTo("string", u8);
        }
        if (support.nodebuffer) {
            return utils.transformTo("string", nodeBuffer(string, "utf-8"));
        }

        // array.join may be slower than string concatenation but generates less objects (less time spent garbage collecting).
        // See also http://jsperf.com/array-direct-assignment-vs-push/31
        var result = [],
            resIndex = 0;

        for (var n = 0; n < string.length; n++) {

            var c = string.charCodeAt(n);

            if (c < 128) {
                result[resIndex++] = String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048)) {
                result[resIndex++] = String.fromCharCode((c >> 6) | 192);
                result[resIndex++] = String.fromCharCode((c & 63) | 128);
            }
            else {
                result[resIndex++] = String.fromCharCode((c >> 12) | 224);
                result[resIndex++] = String.fromCharCode(((c >> 6) & 63) | 128);
                result[resIndex++] = String.fromCharCode((c & 63) | 128);
            }

        }

        return result.join("");
    },

    /**
     * http://www.webtoolkit.info/javascript-utf8.html
     */
    utf8decode: function(input) {
        var result = [],
            resIndex = 0;
        var type = utils.getTypeOf(input);
        var isArray = type !== "string";
        var i = 0;
        var c = 0,
            c1 = 0,
            c2 = 0,
            c3 = 0;

        // check if we can use the TextDecoder API
        // see http://encoding.spec.whatwg.org/#api
        if (textDecoder) {
            return textDecoder.decode(
                utils.transformTo("uint8array", input)
            );
        }
        if (support.nodebuffer) {
            return utils.transformTo("nodebuffer", input).toString("utf-8");
        }

        while (i < input.length) {

            c = isArray ? input[i] : input.charCodeAt(i);

            if (c < 128) {
                result[resIndex++] = String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224)) {
                c2 = isArray ? input[i + 1] : input.charCodeAt(i + 1);
                result[resIndex++] = String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            }
            else {
                c2 = isArray ? input[i + 1] : input.charCodeAt(i + 1);
                c3 = isArray ? input[i + 2] : input.charCodeAt(i + 2);
                result[resIndex++] = String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }

        }

        return result.join("");
    }
};
module.exports = out;

},{"./base64":1,"./compressedObject":2,"./compressions":3,"./defaults":5,"./nodeBuffer":17,"./signature":10,"./support":12,"./utils":14}],10:[function(require,module,exports){

exports.LOCAL_FILE_HEADER = "PK\x03\x04";
exports.CENTRAL_FILE_HEADER = "PK\x01\x02";
exports.CENTRAL_DIRECTORY_END = "PK\x05\x06";
exports.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x06\x07";
exports.ZIP64_CENTRAL_DIRECTORY_END = "PK\x06\x06";
exports.DATA_DESCRIPTOR = "PK\x07\x08";

},{}],11:[function(require,module,exports){

var DataReader = require('./dataReader');
var utils = require('./utils');

function StringReader(data, optimizedBinaryString) {
    this.data = data;
    if (!optimizedBinaryString) {
        this.data = utils.string2binary(this.data);
    }
    this.length = this.data.length;
    this.index = 0;
}
StringReader.prototype = new DataReader();
/**
 * @see DataReader.byteAt
 */
StringReader.prototype.byteAt = function(i) {
    return this.data.charCodeAt(i);
};
/**
 * @see DataReader.lastIndexOfSignature
 */
StringReader.prototype.lastIndexOfSignature = function(sig) {
    return this.data.lastIndexOf(sig);
};
/**
 * @see DataReader.readData
 */
StringReader.prototype.readData = function(size) {
    this.checkOffset(size);
    // this will work because the constructor applied the "& 0xff" mask.
    var result = this.data.slice(this.index, this.index + size);
    this.index += size;
    return result;
};
module.exports = StringReader;

},{"./dataReader":4,"./utils":14}],12:[function(require,module,exports){
var process=require("__browserify_process");
exports.base64 = true;
exports.array = true;
exports.string = true;
exports.arraybuffer = typeof ArrayBuffer !== "undefined" && typeof Uint8Array !== "undefined";
// contains true if JSZip can read/generate nodejs Buffer, false otherwise, aka checks if we arn't in a browser.
exports.nodebuffer = !process.browser;
// contains true if JSZip can read/generate Uint8Array, false otherwise.
exports.uint8array = typeof Uint8Array !== "undefined";

if (typeof ArrayBuffer === "undefined") {
    exports.blob = false;
}
else {
    var buffer = new ArrayBuffer(0);
    try {
        exports.blob = new Blob([buffer], {
            type: "application/zip"
        }).size === 0;
    }
    catch (e) {
        try {
            var Builder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
            var builder = new Builder();
            builder.append(buffer);
            exports.blob = builder.getBlob('application/zip').size === 0;
        }
        catch (e) {
            exports.blob = false;
        }
    }
}

},{"__browserify_process":18}],13:[function(require,module,exports){

var DataReader = require('./dataReader');

function Uint8ArrayReader(data) {
    if (data) {
        this.data = data;
        this.length = this.data.length;
        this.index = 0;
    }
}
Uint8ArrayReader.prototype = new DataReader();
/**
 * @see DataReader.byteAt
 */
Uint8ArrayReader.prototype.byteAt = function(i) {
    return this.data[i];
};
/**
 * @see DataReader.lastIndexOfSignature
 */
Uint8ArrayReader.prototype.lastIndexOfSignature = function(sig) {
    var sig0 = sig.charCodeAt(0),
        sig1 = sig.charCodeAt(1),
        sig2 = sig.charCodeAt(2),
        sig3 = sig.charCodeAt(3);
    for (var i = this.length - 4; i >= 0; --i) {
        if (this.data[i] === sig0 && this.data[i + 1] === sig1 && this.data[i + 2] === sig2 && this.data[i + 3] === sig3) {
            return i;
        }
    }

    return -1;
};
/**
 * @see DataReader.readData
 */
Uint8ArrayReader.prototype.readData = function(size) {
    this.checkOffset(size);
    var result = this.data.subarray(this.index, this.index + size);
    this.index += size;
    return result;
};
module.exports = Uint8ArrayReader;

},{"./dataReader":4}],14:[function(require,module,exports){

var support = require('./support');
var compressions = require('./compressions');
var nodeBuffer = require('./nodeBuffer');
/**
 * Convert a string to a "binary string" : a string containing only char codes between 0 and 255.
 * @param {string} str the string to transform.
 * @return {String} the binary string.
 */
exports.string2binary = function(str) {
    var result = "";
    for (var i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) & 0xff);
    }
    return result;
};
/**
 * Create a Uint8Array from the string.
 * @param {string} str the string to transform.
 * @return {Uint8Array} the typed array.
 * @throws {Error} an Error if the browser doesn't support the requested feature.
 */
exports.string2Uint8Array = function(str) {
    return exports.transformTo("uint8array", str);
};

/**
 * Create a string from the Uint8Array.
 * @param {Uint8Array} array the array to transform.
 * @return {string} the string.
 * @throws {Error} an Error if the browser doesn't support the requested feature.
 */
exports.uint8Array2String = function(array) {
    return exports.transformTo("string", array);
};
/**
 * Create a blob from the given string.
 * @param {string} str the string to transform.
 * @return {Blob} the string.
 * @throws {Error} an Error if the browser doesn't support the requested feature.
 */
exports.string2Blob = function(str) {
    var buffer = exports.transformTo("arraybuffer", str);
    return exports.arrayBuffer2Blob(buffer);
};
exports.arrayBuffer2Blob = function(buffer) {
    exports.checkSupport("blob");

    try {
        // Blob constructor
        return new Blob([buffer], {
            type: "application/zip"
        });
    }
    catch (e) {

        try {
            // deprecated, browser only, old way
            var Builder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
            var builder = new Builder();
            builder.append(buffer);
            return builder.getBlob('application/zip');
        }
        catch (e) {

            // well, fuck ?!
            throw new Error("Bug : can't construct the Blob.");
        }
    }


};
/**
 * The identity function.
 * @param {Object} input the input.
 * @return {Object} the same input.
 */
function identity(input) {
    return input;
}

/**
 * Fill in an array with a string.
 * @param {String} str the string to use.
 * @param {Array|ArrayBuffer|Uint8Array|Buffer} array the array to fill in (will be mutated).
 * @return {Array|ArrayBuffer|Uint8Array|Buffer} the updated array.
 */
function stringToArrayLike(str, array) {
    for (var i = 0; i < str.length; ++i) {
        array[i] = str.charCodeAt(i) & 0xFF;
    }
    return array;
}

/**
 * Transform an array-like object to a string.
 * @param {Array|ArrayBuffer|Uint8Array|Buffer} array the array to transform.
 * @return {String} the result.
 */
function arrayLikeToString(array) {
    // Performances notes :
    // --------------------
    // String.fromCharCode.apply(null, array) is the fastest, see
    // see http://jsperf.com/converting-a-uint8array-to-a-string/2
    // but the stack is limited (and we can get huge arrays !).
    //
    // result += String.fromCharCode(array[i]); generate too many strings !
    //
    // This code is inspired by http://jsperf.com/arraybuffer-to-string-apply-performance/2
    var chunk = 65536;
    var result = [],
        len = array.length,
        type = exports.getTypeOf(array),
        k = 0,
        canUseApply = true;
      try {
         switch(type) {
            case "uint8array":
               String.fromCharCode.apply(null, new Uint8Array(0));
               break;
            case "nodebuffer":
               String.fromCharCode.apply(null, nodeBuffer(0));
               break;
         }
      } catch(e) {
         canUseApply = false;
      }

      // no apply : slow and painful algorithm
      // default browser on android 4.*
      if (!canUseApply) {
         var resultStr = "";
         for(var i = 0; i < array.length;i++) {
            resultStr += String.fromCharCode(array[i]);
         }
    return resultStr;
    }
    while (k < len && chunk > 1) {
        try {
            if (type === "array" || type === "nodebuffer") {
                result.push(String.fromCharCode.apply(null, array.slice(k, Math.min(k + chunk, len))));
            }
            else {
                result.push(String.fromCharCode.apply(null, array.subarray(k, Math.min(k + chunk, len))));
            }
            k += chunk;
        }
        catch (e) {
            chunk = Math.floor(chunk / 2);
        }
    }
    return result.join("");
}

/**
 * Copy the data from an array-like to an other array-like.
 * @param {Array|ArrayBuffer|Uint8Array|Buffer} arrayFrom the origin array.
 * @param {Array|ArrayBuffer|Uint8Array|Buffer} arrayTo the destination array which will be mutated.
 * @return {Array|ArrayBuffer|Uint8Array|Buffer} the updated destination array.
 */
function arrayLikeToArrayLike(arrayFrom, arrayTo) {
    for (var i = 0; i < arrayFrom.length; i++) {
        arrayTo[i] = arrayFrom[i];
    }
    return arrayTo;
}

// a matrix containing functions to transform everything into everything.
var transform = {};

// string to ?
transform["string"] = {
    "string": identity,
    "array": function(input) {
        return stringToArrayLike(input, new Array(input.length));
    },
    "arraybuffer": function(input) {
        return transform["string"]["uint8array"](input).buffer;
    },
    "uint8array": function(input) {
        return stringToArrayLike(input, new Uint8Array(input.length));
    },
    "nodebuffer": function(input) {
        return stringToArrayLike(input, nodeBuffer(input.length));
    }
};

// array to ?
transform["array"] = {
    "string": arrayLikeToString,
    "array": identity,
    "arraybuffer": function(input) {
        return (new Uint8Array(input)).buffer;
    },
    "uint8array": function(input) {
        return new Uint8Array(input);
    },
    "nodebuffer": function(input) {
        return nodeBuffer(input);
    }
};

// arraybuffer to ?
transform["arraybuffer"] = {
    "string": function(input) {
        return arrayLikeToString(new Uint8Array(input));
    },
    "array": function(input) {
        return arrayLikeToArrayLike(new Uint8Array(input), new Array(input.byteLength));
    },
    "arraybuffer": identity,
    "uint8array": function(input) {
        return new Uint8Array(input);
    },
    "nodebuffer": function(input) {
        return nodeBuffer(new Uint8Array(input));
    }
};

// uint8array to ?
transform["uint8array"] = {
    "string": arrayLikeToString,
    "array": function(input) {
        return arrayLikeToArrayLike(input, new Array(input.length));
    },
    "arraybuffer": function(input) {
        return input.buffer;
    },
    "uint8array": identity,
    "nodebuffer": function(input) {
        return nodeBuffer(input);
    }
};

// nodebuffer to ?
transform["nodebuffer"] = {
    "string": arrayLikeToString,
    "array": function(input) {
        return arrayLikeToArrayLike(input, new Array(input.length));
    },
    "arraybuffer": function(input) {
        return transform["nodebuffer"]["uint8array"](input).buffer;
    },
    "uint8array": function(input) {
        return arrayLikeToArrayLike(input, new Uint8Array(input.length));
    },
    "nodebuffer": identity
};

/**
 * Transform an input into any type.
 * The supported output type are : string, array, uint8array, arraybuffer, nodebuffer.
 * If no output type is specified, the unmodified input will be returned.
 * @param {String} outputType the output type.
 * @param {String|Array|ArrayBuffer|Uint8Array|Buffer} input the input to convert.
 * @throws {Error} an Error if the browser doesn't support the requested output type.
 */
exports.transformTo = function(outputType, input) {
    if (!input) {
        // undefined, null, etc
        // an empty string won't harm.
        input = "";
    }
    if (!outputType) {
        return input;
    }
    exports.checkSupport(outputType);
    var inputType = exports.getTypeOf(input);
    var result = transform[inputType][outputType](input);
    return result;
};

/**
 * Return the type of the input.
 * The type will be in a format valid for JSZip.utils.transformTo : string, array, uint8array, arraybuffer.
 * @param {Object} input the input to identify.
 * @return {String} the (lowercase) type of the input.
 */
exports.getTypeOf = function(input) {
    if (typeof input === "string") {
        return "string";
    }
    if (Object.prototype.toString.call(input) === "[object Array]") {
        return "array";
    }
    if (support.nodebuffer && nodeBuffer.test(input)) {
        return "nodebuffer";
    }
    if (support.uint8array && input instanceof Uint8Array) {
        return "uint8array";
    }
    if (support.arraybuffer && input instanceof ArrayBuffer) {
        return "arraybuffer";
    }
};

/**
 * Throw an exception if the type is not supported.
 * @param {String} type the type to check.
 * @throws {Error} an Error if the browser doesn't support the requested type.
 */
exports.checkSupport = function(type) {
    var supported = support[type.toLowerCase()];
    if (!supported) {
        throw new Error(type + " is not supported by this browser");
    }
};
exports.MAX_VALUE_16BITS = 65535;
exports.MAX_VALUE_32BITS = -1; // well, "\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF" is parsed as -1

/**
 * Prettify a string read as binary.
 * @param {string} str the string to prettify.
 * @return {string} a pretty string.
 */
exports.pretty = function(str) {
    var res = '',
        code, i;
    for (i = 0; i < (str || "").length; i++) {
        code = str.charCodeAt(i);
        res += '\\x' + (code < 16 ? "0" : "") + code.toString(16).toUpperCase();
    }
    return res;
};

/**
 * Find a compression registered in JSZip.
 * @param {string} compressionMethod the method magic to find.
 * @return {Object|null} the JSZip compression object, null if none found.
 */
exports.findCompression = function(compressionMethod) {
    for (var method in compressions) {
        if (!compressions.hasOwnProperty(method)) {
            continue;
        }
        if (compressions[method].magic === compressionMethod) {
            return compressions[method];
        }
    }
    return null;
};
/**
* Cross-window, cross-Node-context regular expression detection
* @param  {Object}  object Anything
* @return {Boolean}        true if the object is a regular expression,
* false otherwise
*/
exports.isRegExp = function (object) {
    return Object.prototype.toString.call(object) === "[object RegExp]";
};


},{"./compressions":3,"./nodeBuffer":17,"./support":12}],15:[function(require,module,exports){

var StringReader = require('./stringReader');
var NodeBufferReader = require('./nodeBufferReader');
var Uint8ArrayReader = require('./uint8ArrayReader');
var utils = require('./utils');
var sig = require('./signature');
var ZipEntry = require('./zipEntry');
var support = require('./support');
//  class ZipEntries {{{
/**
 * All the entries in the zip file.
 * @constructor
 * @param {String|ArrayBuffer|Uint8Array} data the binary stream to load.
 * @param {Object} loadOptions Options for loading the stream.
 */
function ZipEntries(data, loadOptions) {
    this.files = [];
    this.loadOptions = loadOptions;
    if (data) {
        this.load(data);
    }
}
ZipEntries.prototype = {
    /**
     * Check that the reader is on the speficied signature.
     * @param {string} expectedSignature the expected signature.
     * @throws {Error} if it is an other signature.
     */
    checkSignature: function(expectedSignature) {
        var signature = this.reader.readString(4);
        if (signature !== expectedSignature) {
            throw new Error("Corrupted zip or bug : unexpected signature " + "(" + utils.pretty(signature) + ", expected " + utils.pretty(expectedSignature) + ")");
        }
    },
    /**
     * Read the end of the central directory.
     */
    readBlockEndOfCentral: function() {
        this.diskNumber = this.reader.readInt(2);
        this.diskWithCentralDirStart = this.reader.readInt(2);
        this.centralDirRecordsOnThisDisk = this.reader.readInt(2);
        this.centralDirRecords = this.reader.readInt(2);
        this.centralDirSize = this.reader.readInt(4);
        this.centralDirOffset = this.reader.readInt(4);

        this.zipCommentLength = this.reader.readInt(2);
        this.zipComment = this.reader.readString(this.zipCommentLength);
    },
    /**
     * Read the end of the Zip 64 central directory.
     * Not merged with the method readEndOfCentral :
     * The end of central can coexist with its Zip64 brother,
     * I don't want to read the wrong number of bytes !
     */
    readBlockZip64EndOfCentral: function() {
        this.zip64EndOfCentralSize = this.reader.readInt(8);
        this.versionMadeBy = this.reader.readString(2);
        this.versionNeeded = this.reader.readInt(2);
        this.diskNumber = this.reader.readInt(4);
        this.diskWithCentralDirStart = this.reader.readInt(4);
        this.centralDirRecordsOnThisDisk = this.reader.readInt(8);
        this.centralDirRecords = this.reader.readInt(8);
        this.centralDirSize = this.reader.readInt(8);
        this.centralDirOffset = this.reader.readInt(8);

        this.zip64ExtensibleData = {};
        var extraDataSize = this.zip64EndOfCentralSize - 44,
            index = 0,
            extraFieldId,
            extraFieldLength,
            extraFieldValue;
        while (index < extraDataSize) {
            extraFieldId = this.reader.readInt(2);
            extraFieldLength = this.reader.readInt(4);
            extraFieldValue = this.reader.readString(extraFieldLength);
            this.zip64ExtensibleData[extraFieldId] = {
                id: extraFieldId,
                length: extraFieldLength,
                value: extraFieldValue
            };
        }
    },
    /**
     * Read the end of the Zip 64 central directory locator.
     */
    readBlockZip64EndOfCentralLocator: function() {
        this.diskWithZip64CentralDirStart = this.reader.readInt(4);
        this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8);
        this.disksCount = this.reader.readInt(4);
        if (this.disksCount > 1) {
            throw new Error("Multi-volumes zip are not supported");
        }
    },
    /**
     * Read the local files, based on the offset read in the central part.
     */
    readLocalFiles: function() {
        var i, file;
        for (i = 0; i < this.files.length; i++) {
            file = this.files[i];
            this.reader.setIndex(file.localHeaderOffset);
            this.checkSignature(sig.LOCAL_FILE_HEADER);
            file.readLocalPart(this.reader);
            file.handleUTF8();
        }
    },
    /**
     * Read the central directory.
     */
    readCentralDir: function() {
        var file;

        this.reader.setIndex(this.centralDirOffset);
        while (this.reader.readString(4) === sig.CENTRAL_FILE_HEADER) {
            file = new ZipEntry({
                zip64: this.zip64
            }, this.loadOptions);
            file.readCentralPart(this.reader);
            this.files.push(file);
        }
    },
    /**
     * Read the end of central directory.
     */
    readEndOfCentral: function() {
        var offset = this.reader.lastIndexOfSignature(sig.CENTRAL_DIRECTORY_END);
        if (offset === -1) {
            throw new Error("Corrupted zip : can't find end of central directory");
        }
        this.reader.setIndex(offset);
        this.checkSignature(sig.CENTRAL_DIRECTORY_END);
        this.readBlockEndOfCentral();


        /* extract from the zip spec :
            4)  If one of the fields in the end of central directory
                record is too small to hold required data, the field
                should be set to -1 (0xFFFF or 0xFFFFFFFF) and the
                ZIP64 format record should be created.
            5)  The end of central directory record and the
                Zip64 end of central directory locator record must
                reside on the same disk when splitting or spanning
                an archive.
         */
        if (this.diskNumber === utils.MAX_VALUE_16BITS || this.diskWithCentralDirStart === utils.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === utils.MAX_VALUE_16BITS || this.centralDirRecords === utils.MAX_VALUE_16BITS || this.centralDirSize === utils.MAX_VALUE_32BITS || this.centralDirOffset === utils.MAX_VALUE_32BITS) {
            this.zip64 = true;

            /*
            Warning : the zip64 extension is supported, but ONLY if the 64bits integer read from
            the zip file can fit into a 32bits integer. This cannot be solved : Javascript represents
            all numbers as 64-bit double precision IEEE 754 floating point numbers.
            So, we have 53bits for integers and bitwise operations treat everything as 32bits.
            see https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Operators/Bitwise_Operators
            and http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-262.pdf section 8.5
            */

            // should look for a zip64 EOCD locator
            offset = this.reader.lastIndexOfSignature(sig.ZIP64_CENTRAL_DIRECTORY_LOCATOR);
            if (offset === -1) {
                throw new Error("Corrupted zip : can't find the ZIP64 end of central directory locator");
            }
            this.reader.setIndex(offset);
            this.checkSignature(sig.ZIP64_CENTRAL_DIRECTORY_LOCATOR);
            this.readBlockZip64EndOfCentralLocator();

            // now the zip64 EOCD record
            this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir);
            this.checkSignature(sig.ZIP64_CENTRAL_DIRECTORY_END);
            this.readBlockZip64EndOfCentral();
        }
    },
    prepareReader: function(data) {
        var type = utils.getTypeOf(data);
        if (type === "string" && !support.uint8array) {
            this.reader = new StringReader(data, this.loadOptions.optimizedBinaryString);
        }
        else if (type === "nodebuffer") {
            this.reader = new NodeBufferReader(data);
        }
        else {
            this.reader = new Uint8ArrayReader(utils.transformTo("uint8array", data));
        }
    },
    /**
     * Read a zip file and create ZipEntries.
     * @param {String|ArrayBuffer|Uint8Array|Buffer} data the binary string representing a zip file.
     */
    load: function(data) {
        this.prepareReader(data);
        this.readEndOfCentral();
        this.readCentralDir();
        this.readLocalFiles();
    }
};
// }}} end of ZipEntries
module.exports = ZipEntries;

},{"./nodeBufferReader":17,"./signature":10,"./stringReader":11,"./support":12,"./uint8ArrayReader":13,"./utils":14,"./zipEntry":16}],16:[function(require,module,exports){

var StringReader = require('./stringReader');
var utils = require('./utils');
var CompressedObject = require('./compressedObject');
var jszipProto = require('./object');
// class ZipEntry {{{
/**
 * An entry in the zip file.
 * @constructor
 * @param {Object} options Options of the current file.
 * @param {Object} loadOptions Options for loading the stream.
 */
function ZipEntry(options, loadOptions) {
    this.options = options;
    this.loadOptions = loadOptions;
}
ZipEntry.prototype = {
    /**
     * say if the file is encrypted.
     * @return {boolean} true if the file is encrypted, false otherwise.
     */
    isEncrypted: function() {
        // bit 1 is set
        return (this.bitFlag & 0x0001) === 0x0001;
    },
    /**
     * say if the file has utf-8 filename/comment.
     * @return {boolean} true if the filename/comment is in utf-8, false otherwise.
     */
    useUTF8: function() {
        // bit 11 is set
        return (this.bitFlag & 0x0800) === 0x0800;
    },
    /**
     * Prepare the function used to generate the compressed content from this ZipFile.
     * @param {DataReader} reader the reader to use.
     * @param {number} from the offset from where we should read the data.
     * @param {number} length the length of the data to read.
     * @return {Function} the callback to get the compressed content (the type depends of the DataReader class).
     */
    prepareCompressedContent: function(reader, from, length) {
        return function() {
            var previousIndex = reader.index;
            reader.setIndex(from);
            var compressedFileData = reader.readData(length);
            reader.setIndex(previousIndex);

            return compressedFileData;
        };
    },
    /**
     * Prepare the function used to generate the uncompressed content from this ZipFile.
     * @param {DataReader} reader the reader to use.
     * @param {number} from the offset from where we should read the data.
     * @param {number} length the length of the data to read.
     * @param {JSZip.compression} compression the compression used on this file.
     * @param {number} uncompressedSize the uncompressed size to expect.
     * @return {Function} the callback to get the uncompressed content (the type depends of the DataReader class).
     */
    prepareContent: function(reader, from, length, compression, uncompressedSize) {
        return function() {

            var compressedFileData = utils.transformTo(compression.uncompressInputType, this.getCompressedContent());
            var uncompressedFileData = compression.uncompress(compressedFileData);

            if (uncompressedFileData.length !== uncompressedSize) {
                throw new Error("Bug : uncompressed data size mismatch");
            }

            return uncompressedFileData;
        };
    },
    /**
     * Read the local part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readLocalPart: function(reader) {
        var compression, localExtraFieldsLength;

        // we already know everything from the central dir !
        // If the central dir data are false, we are doomed.
        // On the bright side, the local part is scary  : zip64, data descriptors, both, etc.
        // The less data we get here, the more reliable this should be.
        // Let's skip the whole header and dash to the data !
        reader.skip(22);
        // in some zip created on windows, the filename stored in the central dir contains \ instead of /.
        // Strangely, the filename here is OK.
        // I would love to treat these zip files as corrupted (see http://www.info-zip.org/FAQ.html#backslashes
        // or APPNOTE#4.4.17.1, "All slashes MUST be forward slashes '/'") but there are a lot of bad zip generators...
        // Search "unzip mismatching "local" filename continuing with "central" filename version" on
        // the internet.
        //
        // I think I see the logic here : the central directory is used to display
        // content and the local directory is used to extract the files. Mixing / and \
        // may be used to display \ to windows users and use / when extracting the files.
        // Unfortunately, this lead also to some issues : http://seclists.org/fulldisclosure/2009/Sep/394
        this.fileNameLength = reader.readInt(2);
        localExtraFieldsLength = reader.readInt(2); // can't be sure this will be the same as the central dir
        this.fileName = reader.readString(this.fileNameLength);
        reader.skip(localExtraFieldsLength);

        if (this.compressedSize == -1 || this.uncompressedSize == -1) {
            throw new Error("Bug or corrupted zip : didn't get enough informations from the central directory " + "(compressedSize == -1 || uncompressedSize == -1)");
        }

        compression = utils.findCompression(this.compressionMethod);
        if (compression === null) { // no compression found
            throw new Error("Corrupted zip : compression " + utils.pretty(this.compressionMethod) + " unknown (inner file : " + this.fileName + ")");
        }
        this.decompressed = new CompressedObject();
        this.decompressed.compressedSize = this.compressedSize;
        this.decompressed.uncompressedSize = this.uncompressedSize;
        this.decompressed.crc32 = this.crc32;
        this.decompressed.compressionMethod = this.compressionMethod;
        this.decompressed.getCompressedContent = this.prepareCompressedContent(reader, reader.index, this.compressedSize, compression);
        this.decompressed.getContent = this.prepareContent(reader, reader.index, this.compressedSize, compression, this.uncompressedSize);

        // we need to compute the crc32...
        if (this.loadOptions.checkCRC32) {
            this.decompressed = utils.transformTo("string", this.decompressed.getContent());
            if (jszipProto.crc32(this.decompressed) !== this.crc32) {
                throw new Error("Corrupted zip : CRC32 mismatch");
            }
        }
    },

    /**
     * Read the central part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readCentralPart: function(reader) {
        this.versionMadeBy = reader.readString(2);
        this.versionNeeded = reader.readInt(2);
        this.bitFlag = reader.readInt(2);
        this.compressionMethod = reader.readString(2);
        this.date = reader.readDate();
        this.crc32 = reader.readInt(4);
        this.compressedSize = reader.readInt(4);
        this.uncompressedSize = reader.readInt(4);
        this.fileNameLength = reader.readInt(2);
        this.extraFieldsLength = reader.readInt(2);
        this.fileCommentLength = reader.readInt(2);
        this.diskNumberStart = reader.readInt(2);
        this.internalFileAttributes = reader.readInt(2);
        this.externalFileAttributes = reader.readInt(4);
        this.localHeaderOffset = reader.readInt(4);

        if (this.isEncrypted()) {
            throw new Error("Encrypted zip are not supported");
        }

        this.fileName = reader.readString(this.fileNameLength);
        this.readExtraFields(reader);
        this.parseZIP64ExtraField(reader);
        this.fileComment = reader.readString(this.fileCommentLength);

        // warning, this is true only for zip with madeBy == DOS (plateform dependent feature)
        this.dir = this.externalFileAttributes & 0x00000010 ? true : false;
    },
    /**
     * Parse the ZIP64 extra field and merge the info in the current ZipEntry.
     * @param {DataReader} reader the reader to use.
     */
    parseZIP64ExtraField: function(reader) {

        if (!this.extraFields[0x0001]) {
            return;
        }

        // should be something, preparing the extra reader
        var extraReader = new StringReader(this.extraFields[0x0001].value);

        // I really hope that these 64bits integer can fit in 32 bits integer, because js
        // won't let us have more.
        if (this.uncompressedSize === utils.MAX_VALUE_32BITS) {
            this.uncompressedSize = extraReader.readInt(8);
        }
        if (this.compressedSize === utils.MAX_VALUE_32BITS) {
            this.compressedSize = extraReader.readInt(8);
        }
        if (this.localHeaderOffset === utils.MAX_VALUE_32BITS) {
            this.localHeaderOffset = extraReader.readInt(8);
        }
        if (this.diskNumberStart === utils.MAX_VALUE_32BITS) {
            this.diskNumberStart = extraReader.readInt(4);
        }
    },
    /**
     * Read the central part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readExtraFields: function(reader) {
        var start = reader.index,
            extraFieldId,
            extraFieldLength,
            extraFieldValue;

        this.extraFields = this.extraFields || {};

        while (reader.index < start + this.extraFieldsLength) {
            extraFieldId = reader.readInt(2);
            extraFieldLength = reader.readInt(2);
            extraFieldValue = reader.readString(extraFieldLength);

            this.extraFields[extraFieldId] = {
                id: extraFieldId,
                length: extraFieldLength,
                value: extraFieldValue
            };
        }
    },
    /**
     * Apply an UTF8 transformation if needed.
     */
    handleUTF8: function() {
        if (this.useUTF8()) {
            this.fileName = jszipProto.utf8decode(this.fileName);
            this.fileComment = jszipProto.utf8decode(this.fileComment);
        } else {
            var upath = this.findExtraFieldUnicodePath();
            if (upath !== null) {
                this.fileName = upath;
            }
        }
    },

    /**
     * Find the unicode path declared in the extra field, if any.
     * @return {String} the unicode path, null otherwise.
     */
    findExtraFieldUnicodePath: function() {
        var upathField = this.extraFields[0x7075];
        if (upathField) {
            var extraReader = new StringReader(upathField.value);

            // wrong version
            if (extraReader.readInt(1) !== 1) {
                return null;
            }

            // the crc of the filename changed, this field is out of date.
            if (jszipProto.crc32(this.fileName) !== extraReader.readInt(4)) {
                return null;
            }

            return jszipProto.utf8decode(extraReader.readString(upathField.length - 5));
        }
        return null;
    }
};
module.exports = ZipEntry;

},{"./compressedObject":2,"./object":9,"./stringReader":11,"./utils":14}],17:[function(require,module,exports){

},{}],18:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],19:[function(require,module,exports){
/** @license zlib.js 2012 - imaya [ https://github.com/imaya/zlib.js ] The MIT License */(function() {var n=void 0,u=!0,aa=this;function ba(e,d){var c=e.split("."),f=aa;!(c[0]in f)&&f.execScript&&f.execScript("var "+c[0]);for(var a;c.length&&(a=c.shift());)!c.length&&d!==n?f[a]=d:f=f[a]?f[a]:f[a]={}};var C="undefined"!==typeof Uint8Array&&"undefined"!==typeof Uint16Array&&"undefined"!==typeof Uint32Array&&"undefined"!==typeof DataView;function K(e,d){this.index="number"===typeof d?d:0;this.d=0;this.buffer=e instanceof(C?Uint8Array:Array)?e:new (C?Uint8Array:Array)(32768);if(2*this.buffer.length<=this.index)throw Error("invalid index");this.buffer.length<=this.index&&ca(this)}function ca(e){var d=e.buffer,c,f=d.length,a=new (C?Uint8Array:Array)(f<<1);if(C)a.set(d);else for(c=0;c<f;++c)a[c]=d[c];return e.buffer=a}
K.prototype.a=function(e,d,c){var f=this.buffer,a=this.index,b=this.d,k=f[a],m;c&&1<d&&(e=8<d?(L[e&255]<<24|L[e>>>8&255]<<16|L[e>>>16&255]<<8|L[e>>>24&255])>>32-d:L[e]>>8-d);if(8>d+b)k=k<<d|e,b+=d;else for(m=0;m<d;++m)k=k<<1|e>>d-m-1&1,8===++b&&(b=0,f[a++]=L[k],k=0,a===f.length&&(f=ca(this)));f[a]=k;this.buffer=f;this.d=b;this.index=a};K.prototype.finish=function(){var e=this.buffer,d=this.index,c;0<this.d&&(e[d]<<=8-this.d,e[d]=L[e[d]],d++);C?c=e.subarray(0,d):(e.length=d,c=e);return c};
var ga=new (C?Uint8Array:Array)(256),M;for(M=0;256>M;++M){for(var R=M,S=R,ha=7,R=R>>>1;R;R>>>=1)S<<=1,S|=R&1,--ha;ga[M]=(S<<ha&255)>>>0}var L=ga;function ja(e){this.buffer=new (C?Uint16Array:Array)(2*e);this.length=0}ja.prototype.getParent=function(e){return 2*((e-2)/4|0)};ja.prototype.push=function(e,d){var c,f,a=this.buffer,b;c=this.length;a[this.length++]=d;for(a[this.length++]=e;0<c;)if(f=this.getParent(c),a[c]>a[f])b=a[c],a[c]=a[f],a[f]=b,b=a[c+1],a[c+1]=a[f+1],a[f+1]=b,c=f;else break;return this.length};
ja.prototype.pop=function(){var e,d,c=this.buffer,f,a,b;d=c[0];e=c[1];this.length-=2;c[0]=c[this.length];c[1]=c[this.length+1];for(b=0;;){a=2*b+2;if(a>=this.length)break;a+2<this.length&&c[a+2]>c[a]&&(a+=2);if(c[a]>c[b])f=c[b],c[b]=c[a],c[a]=f,f=c[b+1],c[b+1]=c[a+1],c[a+1]=f;else break;b=a}return{index:e,value:d,length:this.length}};function ka(e,d){this.e=ma;this.f=0;this.input=C&&e instanceof Array?new Uint8Array(e):e;this.c=0;d&&(d.lazy&&(this.f=d.lazy),"number"===typeof d.compressionType&&(this.e=d.compressionType),d.outputBuffer&&(this.b=C&&d.outputBuffer instanceof Array?new Uint8Array(d.outputBuffer):d.outputBuffer),"number"===typeof d.outputIndex&&(this.c=d.outputIndex));this.b||(this.b=new (C?Uint8Array:Array)(32768))}var ma=2,T=[],U;
for(U=0;288>U;U++)switch(u){case 143>=U:T.push([U+48,8]);break;case 255>=U:T.push([U-144+400,9]);break;case 279>=U:T.push([U-256+0,7]);break;case 287>=U:T.push([U-280+192,8]);break;default:throw"invalid literal: "+U;}
ka.prototype.h=function(){var e,d,c,f,a=this.input;switch(this.e){case 0:c=0;for(f=a.length;c<f;){d=C?a.subarray(c,c+65535):a.slice(c,c+65535);c+=d.length;var b=d,k=c===f,m=n,g=n,p=n,v=n,x=n,l=this.b,h=this.c;if(C){for(l=new Uint8Array(this.b.buffer);l.length<=h+b.length+5;)l=new Uint8Array(l.length<<1);l.set(this.b)}m=k?1:0;l[h++]=m|0;g=b.length;p=~g+65536&65535;l[h++]=g&255;l[h++]=g>>>8&255;l[h++]=p&255;l[h++]=p>>>8&255;if(C)l.set(b,h),h+=b.length,l=l.subarray(0,h);else{v=0;for(x=b.length;v<x;++v)l[h++]=
b[v];l.length=h}this.c=h;this.b=l}break;case 1:var q=new K(C?new Uint8Array(this.b.buffer):this.b,this.c);q.a(1,1,u);q.a(1,2,u);var t=na(this,a),w,da,z;w=0;for(da=t.length;w<da;w++)if(z=t[w],K.prototype.a.apply(q,T[z]),256<z)q.a(t[++w],t[++w],u),q.a(t[++w],5),q.a(t[++w],t[++w],u);else if(256===z)break;this.b=q.finish();this.c=this.b.length;break;case ma:var B=new K(C?new Uint8Array(this.b.buffer):this.b,this.c),ra,J,N,O,P,Ia=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],W,sa,X,ta,ea,ia=Array(19),
ua,Q,fa,y,va;ra=ma;B.a(1,1,u);B.a(ra,2,u);J=na(this,a);W=oa(this.j,15);sa=pa(W);X=oa(this.i,7);ta=pa(X);for(N=286;257<N&&0===W[N-1];N--);for(O=30;1<O&&0===X[O-1];O--);var wa=N,xa=O,F=new (C?Uint32Array:Array)(wa+xa),r,G,s,Y,E=new (C?Uint32Array:Array)(316),D,A,H=new (C?Uint8Array:Array)(19);for(r=G=0;r<wa;r++)F[G++]=W[r];for(r=0;r<xa;r++)F[G++]=X[r];if(!C){r=0;for(Y=H.length;r<Y;++r)H[r]=0}r=D=0;for(Y=F.length;r<Y;r+=G){for(G=1;r+G<Y&&F[r+G]===F[r];++G);s=G;if(0===F[r])if(3>s)for(;0<s--;)E[D++]=0,
H[0]++;else for(;0<s;)A=138>s?s:138,A>s-3&&A<s&&(A=s-3),10>=A?(E[D++]=17,E[D++]=A-3,H[17]++):(E[D++]=18,E[D++]=A-11,H[18]++),s-=A;else if(E[D++]=F[r],H[F[r]]++,s--,3>s)for(;0<s--;)E[D++]=F[r],H[F[r]]++;else for(;0<s;)A=6>s?s:6,A>s-3&&A<s&&(A=s-3),E[D++]=16,E[D++]=A-3,H[16]++,s-=A}e=C?E.subarray(0,D):E.slice(0,D);ea=oa(H,7);for(y=0;19>y;y++)ia[y]=ea[Ia[y]];for(P=19;4<P&&0===ia[P-1];P--);ua=pa(ea);B.a(N-257,5,u);B.a(O-1,5,u);B.a(P-4,4,u);for(y=0;y<P;y++)B.a(ia[y],3,u);y=0;for(va=e.length;y<va;y++)if(Q=
e[y],B.a(ua[Q],ea[Q],u),16<=Q){y++;switch(Q){case 16:fa=2;break;case 17:fa=3;break;case 18:fa=7;break;default:throw"invalid code: "+Q;}B.a(e[y],fa,u)}var ya=[sa,W],za=[ta,X],I,Aa,Z,la,Ba,Ca,Da,Ea;Ba=ya[0];Ca=ya[1];Da=za[0];Ea=za[1];I=0;for(Aa=J.length;I<Aa;++I)if(Z=J[I],B.a(Ba[Z],Ca[Z],u),256<Z)B.a(J[++I],J[++I],u),la=J[++I],B.a(Da[la],Ea[la],u),B.a(J[++I],J[++I],u);else if(256===Z)break;this.b=B.finish();this.c=this.b.length;break;default:throw"invalid compression type";}return this.b};
function qa(e,d){this.length=e;this.g=d}
var Fa=function(){function e(a){switch(u){case 3===a:return[257,a-3,0];case 4===a:return[258,a-4,0];case 5===a:return[259,a-5,0];case 6===a:return[260,a-6,0];case 7===a:return[261,a-7,0];case 8===a:return[262,a-8,0];case 9===a:return[263,a-9,0];case 10===a:return[264,a-10,0];case 12>=a:return[265,a-11,1];case 14>=a:return[266,a-13,1];case 16>=a:return[267,a-15,1];case 18>=a:return[268,a-17,1];case 22>=a:return[269,a-19,2];case 26>=a:return[270,a-23,2];case 30>=a:return[271,a-27,2];case 34>=a:return[272,
a-31,2];case 42>=a:return[273,a-35,3];case 50>=a:return[274,a-43,3];case 58>=a:return[275,a-51,3];case 66>=a:return[276,a-59,3];case 82>=a:return[277,a-67,4];case 98>=a:return[278,a-83,4];case 114>=a:return[279,a-99,4];case 130>=a:return[280,a-115,4];case 162>=a:return[281,a-131,5];case 194>=a:return[282,a-163,5];case 226>=a:return[283,a-195,5];case 257>=a:return[284,a-227,5];case 258===a:return[285,a-258,0];default:throw"invalid length: "+a;}}var d=[],c,f;for(c=3;258>=c;c++)f=e(c),d[c]=f[2]<<24|
f[1]<<16|f[0];return d}(),Ga=C?new Uint32Array(Fa):Fa;
function na(e,d){function c(a,c){var b=a.g,d=[],f=0,e;e=Ga[a.length];d[f++]=e&65535;d[f++]=e>>16&255;d[f++]=e>>24;var g;switch(u){case 1===b:g=[0,b-1,0];break;case 2===b:g=[1,b-2,0];break;case 3===b:g=[2,b-3,0];break;case 4===b:g=[3,b-4,0];break;case 6>=b:g=[4,b-5,1];break;case 8>=b:g=[5,b-7,1];break;case 12>=b:g=[6,b-9,2];break;case 16>=b:g=[7,b-13,2];break;case 24>=b:g=[8,b-17,3];break;case 32>=b:g=[9,b-25,3];break;case 48>=b:g=[10,b-33,4];break;case 64>=b:g=[11,b-49,4];break;case 96>=b:g=[12,b-
65,5];break;case 128>=b:g=[13,b-97,5];break;case 192>=b:g=[14,b-129,6];break;case 256>=b:g=[15,b-193,6];break;case 384>=b:g=[16,b-257,7];break;case 512>=b:g=[17,b-385,7];break;case 768>=b:g=[18,b-513,8];break;case 1024>=b:g=[19,b-769,8];break;case 1536>=b:g=[20,b-1025,9];break;case 2048>=b:g=[21,b-1537,9];break;case 3072>=b:g=[22,b-2049,10];break;case 4096>=b:g=[23,b-3073,10];break;case 6144>=b:g=[24,b-4097,11];break;case 8192>=b:g=[25,b-6145,11];break;case 12288>=b:g=[26,b-8193,12];break;case 16384>=
b:g=[27,b-12289,12];break;case 24576>=b:g=[28,b-16385,13];break;case 32768>=b:g=[29,b-24577,13];break;default:throw"invalid distance";}e=g;d[f++]=e[0];d[f++]=e[1];d[f++]=e[2];var k,m;k=0;for(m=d.length;k<m;++k)l[h++]=d[k];t[d[0]]++;w[d[3]]++;q=a.length+c-1;x=null}var f,a,b,k,m,g={},p,v,x,l=C?new Uint16Array(2*d.length):[],h=0,q=0,t=new (C?Uint32Array:Array)(286),w=new (C?Uint32Array:Array)(30),da=e.f,z;if(!C){for(b=0;285>=b;)t[b++]=0;for(b=0;29>=b;)w[b++]=0}t[256]=1;f=0;for(a=d.length;f<a;++f){b=
m=0;for(k=3;b<k&&f+b!==a;++b)m=m<<8|d[f+b];g[m]===n&&(g[m]=[]);p=g[m];if(!(0<q--)){for(;0<p.length&&32768<f-p[0];)p.shift();if(f+3>=a){x&&c(x,-1);b=0;for(k=a-f;b<k;++b)z=d[f+b],l[h++]=z,++t[z];break}0<p.length?(v=Ha(d,f,p),x?x.length<v.length?(z=d[f-1],l[h++]=z,++t[z],c(v,0)):c(x,-1):v.length<da?x=v:c(v,0)):x?c(x,-1):(z=d[f],l[h++]=z,++t[z])}p.push(f)}l[h++]=256;t[256]++;e.j=t;e.i=w;return C?l.subarray(0,h):l}
function Ha(e,d,c){var f,a,b=0,k,m,g,p,v=e.length;m=0;p=c.length;a:for(;m<p;m++){f=c[p-m-1];k=3;if(3<b){for(g=b;3<g;g--)if(e[f+g-1]!==e[d+g-1])continue a;k=b}for(;258>k&&d+k<v&&e[f+k]===e[d+k];)++k;k>b&&(a=f,b=k);if(258===k)break}return new qa(b,d-a)}
function oa(e,d){var c=e.length,f=new ja(572),a=new (C?Uint8Array:Array)(c),b,k,m,g,p;if(!C)for(g=0;g<c;g++)a[g]=0;for(g=0;g<c;++g)0<e[g]&&f.push(g,e[g]);b=Array(f.length/2);k=new (C?Uint32Array:Array)(f.length/2);if(1===b.length)return a[f.pop().index]=1,a;g=0;for(p=f.length/2;g<p;++g)b[g]=f.pop(),k[g]=b[g].value;m=Ja(k,k.length,d);g=0;for(p=b.length;g<p;++g)a[b[g].index]=m[g];return a}
function Ja(e,d,c){function f(a){var b=g[a][p[a]];b===d?(f(a+1),f(a+1)):--k[b];++p[a]}var a=new (C?Uint16Array:Array)(c),b=new (C?Uint8Array:Array)(c),k=new (C?Uint8Array:Array)(d),m=Array(c),g=Array(c),p=Array(c),v=(1<<c)-d,x=1<<c-1,l,h,q,t,w;a[c-1]=d;for(h=0;h<c;++h)v<x?b[h]=0:(b[h]=1,v-=x),v<<=1,a[c-2-h]=(a[c-1-h]/2|0)+d;a[0]=b[0];m[0]=Array(a[0]);g[0]=Array(a[0]);for(h=1;h<c;++h)a[h]>2*a[h-1]+b[h]&&(a[h]=2*a[h-1]+b[h]),m[h]=Array(a[h]),g[h]=Array(a[h]);for(l=0;l<d;++l)k[l]=c;for(q=0;q<a[c-1];++q)m[c-
1][q]=e[q],g[c-1][q]=q;for(l=0;l<c;++l)p[l]=0;1===b[c-1]&&(--k[0],++p[c-1]);for(h=c-2;0<=h;--h){t=l=0;w=p[h+1];for(q=0;q<a[h];q++)t=m[h+1][w]+m[h+1][w+1],t>e[l]?(m[h][q]=t,g[h][q]=d,w+=2):(m[h][q]=e[l],g[h][q]=l,++l);p[h]=0;1===b[h]&&f(h)}return k}
function pa(e){var d=new (C?Uint16Array:Array)(e.length),c=[],f=[],a=0,b,k,m,g;b=0;for(k=e.length;b<k;b++)c[e[b]]=(c[e[b]]|0)+1;b=1;for(k=16;b<=k;b++)f[b]=a,a+=c[b]|0,a<<=1;b=0;for(k=e.length;b<k;b++){a=f[e[b]];f[e[b]]+=1;m=d[b]=0;for(g=e[b];m<g;m++)d[b]=d[b]<<1|a&1,a>>>=1}return d};ba("Zlib.RawDeflate",ka);ba("Zlib.RawDeflate.prototype.compress",ka.prototype.h);var Ka={NONE:0,FIXED:1,DYNAMIC:ma},V,La,$,Ma;if(Object.keys)V=Object.keys(Ka);else for(La in V=[],$=0,Ka)V[$++]=La;$=0;for(Ma=V.length;$<Ma;++$)La=V[$],ba("Zlib.RawDeflate.CompressionType."+La,Ka[La]);}).call(this); 

},{}],20:[function(require,module,exports){
/** @license zlib.js 2012 - imaya [ https://github.com/imaya/zlib.js ] The MIT License */(function() {var l=this;function p(b,e){var a=b.split("."),c=l;!(a[0]in c)&&c.execScript&&c.execScript("var "+a[0]);for(var d;a.length&&(d=a.shift());)!a.length&&void 0!==e?c[d]=e:c=c[d]?c[d]:c[d]={}};var q="undefined"!==typeof Uint8Array&&"undefined"!==typeof Uint16Array&&"undefined"!==typeof Uint32Array&&"undefined"!==typeof DataView;function t(b){var e=b.length,a=0,c=Number.POSITIVE_INFINITY,d,f,g,h,k,m,r,n,s,J;for(n=0;n<e;++n)b[n]>a&&(a=b[n]),b[n]<c&&(c=b[n]);d=1<<a;f=new (q?Uint32Array:Array)(d);g=1;h=0;for(k=2;g<=a;){for(n=0;n<e;++n)if(b[n]===g){m=0;r=h;for(s=0;s<g;++s)m=m<<1|r&1,r>>=1;J=g<<16|n;for(s=m;s<d;s+=k)f[s]=J;++h}++g;h<<=1;k<<=1}return[f,a,c]};function u(b,e){this.g=[];this.h=32768;this.c=this.f=this.d=this.k=0;this.input=q?new Uint8Array(b):b;this.l=!1;this.i=v;this.q=!1;if(e||!(e={}))e.index&&(this.d=e.index),e.bufferSize&&(this.h=e.bufferSize),e.bufferType&&(this.i=e.bufferType),e.resize&&(this.q=e.resize);switch(this.i){case w:this.a=32768;this.b=new (q?Uint8Array:Array)(32768+this.h+258);break;case v:this.a=0;this.b=new (q?Uint8Array:Array)(this.h);this.e=this.v;this.m=this.s;this.j=this.t;break;default:throw Error("invalid inflate mode");
}}var w=0,v=1;
u.prototype.u=function(){for(;!this.l;){var b=x(this,3);b&1&&(this.l=!0);b>>>=1;switch(b){case 0:var e=this.input,a=this.d,c=this.b,d=this.a,f=e.length,g=void 0,h=void 0,k=c.length,m=void 0;this.c=this.f=0;if(a+1>=f)throw Error("invalid uncompressed block header: LEN");g=e[a++]|e[a++]<<8;if(a+1>=f)throw Error("invalid uncompressed block header: NLEN");h=e[a++]|e[a++]<<8;if(g===~h)throw Error("invalid uncompressed block header: length verify");if(a+g>e.length)throw Error("input buffer is broken");switch(this.i){case w:for(;d+
g>c.length;){m=k-d;g-=m;if(q)c.set(e.subarray(a,a+m),d),d+=m,a+=m;else for(;m--;)c[d++]=e[a++];this.a=d;c=this.e();d=this.a}break;case v:for(;d+g>c.length;)c=this.e({o:2});break;default:throw Error("invalid inflate mode");}if(q)c.set(e.subarray(a,a+g),d),d+=g,a+=g;else for(;g--;)c[d++]=e[a++];this.d=a;this.a=d;this.b=c;break;case 1:this.j(y,z);break;case 2:A(this);break;default:throw Error("unknown BTYPE: "+b);}}return this.m()};
var B=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],C=q?new Uint16Array(B):B,D=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,258,258],E=q?new Uint16Array(D):D,F=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0],G=q?new Uint8Array(F):F,H=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],I=q?new Uint16Array(H):H,K=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,
13],L=q?new Uint8Array(K):K,M=new (q?Uint8Array:Array)(288),N,O;N=0;for(O=M.length;N<O;++N)M[N]=143>=N?8:255>=N?9:279>=N?7:8;var y=t(M),P=new (q?Uint8Array:Array)(30),Q,R;Q=0;for(R=P.length;Q<R;++Q)P[Q]=5;var z=t(P);function x(b,e){for(var a=b.f,c=b.c,d=b.input,f=b.d,g=d.length,h;c<e;){if(f>=g)throw Error("input buffer is broken");a|=d[f++]<<c;c+=8}h=a&(1<<e)-1;b.f=a>>>e;b.c=c-e;b.d=f;return h}
function S(b,e){for(var a=b.f,c=b.c,d=b.input,f=b.d,g=d.length,h=e[0],k=e[1],m,r;c<k&&!(f>=g);)a|=d[f++]<<c,c+=8;m=h[a&(1<<k)-1];r=m>>>16;b.f=a>>r;b.c=c-r;b.d=f;return m&65535}
function A(b){function e(a,b,c){var e,d=this.p,f,g;for(g=0;g<a;)switch(e=S(this,b),e){case 16:for(f=3+x(this,2);f--;)c[g++]=d;break;case 17:for(f=3+x(this,3);f--;)c[g++]=0;d=0;break;case 18:for(f=11+x(this,7);f--;)c[g++]=0;d=0;break;default:d=c[g++]=e}this.p=d;return c}var a=x(b,5)+257,c=x(b,5)+1,d=x(b,4)+4,f=new (q?Uint8Array:Array)(C.length),g,h,k,m;for(m=0;m<d;++m)f[C[m]]=x(b,3);if(!q){m=d;for(d=f.length;m<d;++m)f[C[m]]=0}g=t(f);h=new (q?Uint8Array:Array)(a);k=new (q?Uint8Array:Array)(c);b.p=0;
b.j(t(e.call(b,a,g,h)),t(e.call(b,c,g,k)))}u.prototype.j=function(b,e){var a=this.b,c=this.a;this.n=b;for(var d=a.length-258,f,g,h,k;256!==(f=S(this,b));)if(256>f)c>=d&&(this.a=c,a=this.e(),c=this.a),a[c++]=f;else{g=f-257;k=E[g];0<G[g]&&(k+=x(this,G[g]));f=S(this,e);h=I[f];0<L[f]&&(h+=x(this,L[f]));c>=d&&(this.a=c,a=this.e(),c=this.a);for(;k--;)a[c]=a[c++-h]}for(;8<=this.c;)this.c-=8,this.d--;this.a=c};
u.prototype.t=function(b,e){var a=this.b,c=this.a;this.n=b;for(var d=a.length,f,g,h,k;256!==(f=S(this,b));)if(256>f)c>=d&&(a=this.e(),d=a.length),a[c++]=f;else{g=f-257;k=E[g];0<G[g]&&(k+=x(this,G[g]));f=S(this,e);h=I[f];0<L[f]&&(h+=x(this,L[f]));c+k>d&&(a=this.e(),d=a.length);for(;k--;)a[c]=a[c++-h]}for(;8<=this.c;)this.c-=8,this.d--;this.a=c};
u.prototype.e=function(){var b=new (q?Uint8Array:Array)(this.a-32768),e=this.a-32768,a,c,d=this.b;if(q)b.set(d.subarray(32768,b.length));else{a=0;for(c=b.length;a<c;++a)b[a]=d[a+32768]}this.g.push(b);this.k+=b.length;if(q)d.set(d.subarray(e,e+32768));else for(a=0;32768>a;++a)d[a]=d[e+a];this.a=32768;return d};
u.prototype.v=function(b){var e,a=this.input.length/this.d+1|0,c,d,f,g=this.input,h=this.b;b&&("number"===typeof b.o&&(a=b.o),"number"===typeof b.r&&(a+=b.r));2>a?(c=(g.length-this.d)/this.n[2],f=258*(c/2)|0,d=f<h.length?h.length+f:h.length<<1):d=h.length*a;q?(e=new Uint8Array(d),e.set(h)):e=h;return this.b=e};
u.prototype.m=function(){var b=0,e=this.b,a=this.g,c,d=new (q?Uint8Array:Array)(this.k+(this.a-32768)),f,g,h,k;if(0===a.length)return q?this.b.subarray(32768,this.a):this.b.slice(32768,this.a);f=0;for(g=a.length;f<g;++f){c=a[f];h=0;for(k=c.length;h<k;++h)d[b++]=c[h]}f=32768;for(g=this.a;f<g;++f)d[b++]=e[f];this.g=[];return this.buffer=d};
u.prototype.s=function(){var b,e=this.a;q?this.q?(b=new Uint8Array(e),b.set(this.b.subarray(0,e))):b=this.b.subarray(0,e):(this.b.length>e&&(this.b.length=e),b=this.b);return this.buffer=b};p("Zlib.RawInflate",u);p("Zlib.RawInflate.prototype.decompress",u.prototype.u);var T={ADAPTIVE:v,BLOCK:w},U,V,W,X;if(Object.keys)U=Object.keys(T);else for(V in U=[],W=0,T)U[W++]=V;W=0;for(X=U.length;W<X;++W)V=U[W],p("Zlib.RawInflate.BufferType."+V,T[V]);}).call(this); 

},{}]},{},[7])
(7)
});
;
/*globals define */
/**
 * Generated by PluginGenerator from webgme on Thu May 08 2014 17:59:46 GMT-0500 (CDT).
 */

define( 'plugin/AcmImporter/AcmImporter/AcmImporter',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/AcmImporter/AcmImporter/meta',
    'jszip',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, MetaTypes, JSZip, Xml2Json ) {
    

    /**
     * Initializes a new instance of AcmImporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin AcmImporter.
     * @constructor
     */
    var AcmImporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.metaTypes = MetaTypes;
        this.id2NodeMap = {};
        this.valueFlowIdMap = {};
        this.recursionCounter = 0;
        this.id2ComponentMap = {};
        this.deleteExisting = false;
        this.cleanImport = true;
        this.projectNode = null;

        //this.propertyJson = {};
    };

    // Prototypal inheritance from PluginBase.
    AcmImporter.prototype = Object.create( PluginBase.prototype );
    AcmImporter.prototype.constructor = AcmImporter;

    /**
     * Gets the name of the AcmImporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    AcmImporter.prototype.getName = function () {
        return "ACM Importer";
    };

    /**
     * Gets the semantic version (semver.org) of the AcmImporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    AcmImporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the AcmImporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    AcmImporter.prototype.getDescription = function () {
        return "Imports one or more *.acm files and creates the WebGME objects";
    };

    /**
     * Gets the configuration structure for the AcmImporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    AcmImporter.prototype.getConfigStructure = function () {
        return [ {
            "name": "UploadedFile", // May be a single .acm or a zip containing several
            "displayName": "ACMs",
            "description": "Click and drag one or more *.acm files",
            //"value": "1eaa1570554d13e407265713cb8e93388f6908c8",
            //"value": "001ccfcecbe33a9512cc6fbbdc5947d363deb273",
            "value": "", // FinalDrive w/2 classifications
            "valueType": "asset",
            "readOnly": false
        }, {
            "name": "VulcanLink", // May be a single .acm or a zip containing several
            "displayName": "ACM Link",
            "description": "Drag component link here",
            "value": "",
            "valueType": "vulcanLink",
            "readOnly": false
        }, {
            "name": "DeleteExisting",
            "displayName": "DeleteExisting",
            "description": "Deletes any existing AVMComponent with matching ID",
            "value": false,
            "valueType": "boolean",
            "readOnly": false
        } ];
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} mainCallback - the result callback
     */
    AcmImporter.prototype.main = function ( mainCallback ) {
        var self = this,
            acmFolderNode,
            currentConfig = self.getCurrentConfig(),
            uploadedFileHash = currentConfig.UploadedFile || currentConfig.VulcanLink,
            //uploadedFileHash = 'e0ebaea243ad1f5dc8278638c36d8a6fc03f0ab7',
            newAcm,
            numUploaded,
            numExisting = 0, // count any existing (acm) objects in this folder
            numCreated = 0,
            xPosition,
            yPosition,
            xOffset = 100,
            yOffset = 100,
            xSpacing = 200,
            ySpacing = 200,
            componentsPerRow = 6;

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node not found! Try selecting another model and re-opening the desired model', 'error' );
            mainCallback( 'Active node not found!', self.result );
            return;
        }

        self.updateMETA( self.metaTypes );

        if ( !self.isMetaTypeOf( self.activeNode, MetaTypes.ACMFolder ) ) {
            var msg = "AcmImporter must be called from an ACMFolder!";
            self.logger.error( msg );
            self.createMessage( self.activeNode, msg, 'error' );
            self.result.setSuccess( false );
            mainCallback( null, self.result );
            return;
        }

        acmFolderNode = self.activeNode;

        self.projectNode = self.getWorkspaceNode( acmFolderNode );
        self.deleteExisting = currentConfig.DeleteExisting;

        var findComponentsCallback = function () {
            var loadChildrenCallback = function ( err, children ) {
                if ( err ) {
                    self.createMessage( acmFolderNode, 'Could not load children of ' + self.core.getName(
                        acmFolderNode ), 'error' );
                    self.logger.error( 'Could not load children of ' + self.core.getName( acmFolderNode ) +
                        ', err: ' + err );
                    self.result.setSuccess( false );
                    mainCallback( err, self.result );
                    return;
                }

                numExisting = children.length;

                var getAcmDescriptionCallback = function ( err, hash2acmJsonMap ) {
                    if ( err ) {
                        mainCallback( err, self.result );
                        return;
                    }

                    numUploaded = Object.keys( hash2acmJsonMap )
                        .length;

                    var acmJson;

                    for ( var hash in hash2acmJsonMap ) {
                        acmJson = hash2acmJsonMap[ hash ];
                        newAcm = self.createNewAcm( acmFolderNode, hash, acmJson );

                        xPosition = xOffset + xSpacing * ( numExisting % componentsPerRow );
                        yPosition = yOffset + ySpacing * ( Math.floor( numExisting / componentsPerRow ) );
                        self.core.setRegistry( newAcm, 'position', {
                            x: xPosition,
                            y: yPosition
                        } );

                        numExisting += 1;
                        numCreated += 1;
                    }

                    //var propertyString = JSON.stringify(self.propertyJson, null, 4);

                    self.save( 'added obj', function ( err ) {
                        if ( err ) {
                            mainCallback( err, self.result );
                            return;
                        }
                        if ( numUploaded > 1 ) {
                            self.createMessage( acmFolderNode, numCreated + ' ACMs created out of ' +
                                numUploaded + ' uploaded.', 'info' );
                        }
                        if ( self.cleanImport === true ) {
                            self.result.setSuccess( true );
                        } else {
                            self.result.setSuccess( false );
                        }

                        mainCallback( null, self.result );
                    } );
                };

                self.getAcmDetails( uploadedFileHash, getAcmDescriptionCallback );
            };

            self.core.loadChildren( acmFolderNode, loadChildrenCallback );
        };
        self.findComponentsRecursive( self.projectNode, findComponentsCallback );
    };

    AcmImporter.prototype.getWorkspaceNode = function ( node ) {
        var self = this;
        while ( node ) {
            if ( self.isMetaTypeOf( node, self.metaTypes.WorkSpace ) ) {
                self.logger.info( 'Found work-space node : ' + self.core.getAttribute( node, 'name' ) );
                return node;
            }
            node = self.core.getParent( node );
        }
        self.logger.error( 'Could not find work-space node!!' );
    };

    AcmImporter.prototype.findComponentsRecursive = function ( node, callback ) {
        // TODO: Error handling
        var self = this,
            metaTypeName = self.core.getAttribute( self.getMetaType( node ), 'name' ),
            loadChildrenCallback = function ( err, children ) {
                self.recursionCounter += children.length;

                for ( var i = 0; i < children.length; i += 1 ) {
                    self.findComponentsRecursive( children[ i ], callback );
                }

                self.recursionCounter -= 1;

                if ( self.recursionCounter === 0 ) {
                    callback();
                }
            };

        if ( metaTypeName === 'WorkSpace' ) {
            self.recursionCounter += 1;
            self.core.loadChildren( node, loadChildrenCallback );
        } else if ( metaTypeName === 'ACMFolder' ) {
            self.core.loadChildren( node, loadChildrenCallback );
        } else {
            if ( metaTypeName === 'AVMComponentModel' ) {
                // Check if id2ComponentMap already has the ID - if so create a message about that node and overwrite it
                // in the map.
                self.id2ComponentMap[ self.core.getAttribute( node, 'ID' ) ] = node;
            }

            self.recursionCounter -= 1;

            if ( self.recursionCounter === 0 ) {
                callback();
            }
        }
    };

    AcmImporter.prototype.createNewAcm = function ( acmFolderNode, hash, acmJson ) {
        var self = this,
            existingAcmNodeWithSameId,
            existingAcmParentFolder,
            newAcmNode,
            avmComponent = acmJson[ 'Component' ] || acmJson[ 'avm:Component' ],
            name = avmComponent[ '@Name' ],
            id = avmComponent[ '@ID' ],
            schemaVersion = avmComponent[ '@SchemaVersion' ],
            version = avmComponent[ '@Version' ],
            avmProperties,
            avmConnectors,
            avmDomainModels,
            avmPorts,
            formulas,
            i,
            msg;

        if ( typeof self.metaTypes.ACMFolder !== 'object' ) {
            self.updateMETA( self.metaTypes );
        }

        if ( self.id2ComponentMap.hasOwnProperty( id ) ) {
            existingAcmNodeWithSameId = self.id2ComponentMap[ id ];
            existingAcmParentFolder = self.core.getParent( existingAcmNodeWithSameId );

            if ( self.deleteExisting ) {
                self.core.deleteNode( existingAcmNodeWithSameId );
                msg = "Deleted existing AVMComponent with ID '" + id + "'";
                self.logger.warning( msg );
                self.createMessage( existingAcmParentFolder, msg, 'debug' );
            } else {
                msg = "Found existing AVMComponent with ID '" + id + "'";
                self.logger.warning( msg );
                self.createMessage( existingAcmNodeWithSameId, msg, 'warning' );
            }
        }

        self.logger.debug( "Creating new ACM: " + name );
        newAcmNode = self.core.createNode( {
            parent: acmFolderNode,
            base: MetaTypes.AVMComponentModel
        } );
        self.id2ComponentMap[ id ] = newAcmNode;
        self.id2NodeMap = {};

        if ( avmComponent.hasOwnProperty( 'Classifications' ) && avmComponent[ 'Classifications' ][ '#text' ] ) {
            self.core.setAttribute( newAcmNode, 'Classifications', avmComponent[ 'Classifications' ][ '#text' ] );
        }

        self.core.setAttribute( newAcmNode, 'name', name );
        self.core.setAttribute( newAcmNode, 'SchemaVersion', schemaVersion );
        self.core.setAttribute( newAcmNode, 'Version', version );
        self.core.setAttribute( newAcmNode, 'ID', id );
        self.core.setAttribute( newAcmNode, 'Resource', hash );

        if ( avmComponent.hasOwnProperty( 'Connector' ) ) {
            avmConnectors = avmComponent[ 'Connector' ];

            for ( i = 0; i < avmConnectors.length; i += 1 ) {
                self.createNewConnector( avmConnectors[ i ], newAcmNode );
            }
        }
        if ( avmComponent.hasOwnProperty( 'Port' ) ) {
            avmPorts = avmComponent[ 'Port' ];

            for ( i = 0; i < avmPorts.length; i += 1 ) {
                self.createNewDomainPort( avmPorts[ i ], newAcmNode );
            }
        }
        if ( avmComponent.hasOwnProperty( 'Property' ) ) {
            avmProperties = avmComponent[ 'Property' ];

            for ( i = 0; i < avmProperties.length; i += 1 ) {
                self.createNewProperty( avmProperties[ i ], newAcmNode );
            }
        }
        if ( avmComponent.hasOwnProperty( 'DomainModel' ) ) {
            avmDomainModels = avmComponent[ 'DomainModel' ];

            for ( i = 0; i < avmDomainModels.length; i += 1 ) {
                self.createNewDomainModel( avmDomainModels[ i ], newAcmNode );
            }
        }
        if ( avmComponent.hasOwnProperty( 'Formula' ) ) {
            formulas = avmComponent[ 'Formula' ];

            for ( i = 0; i < formulas.length; i += 1 ) {
                self.createNewFormula( formulas[ i ], newAcmNode );
            }
        }

        // make value flow connections
        self.makeValueFlows( self.valueFlowIdMap, newAcmNode );

        return newAcmNode;
    };

    AcmImporter.prototype.createNewDomainModel = function ( avmDomainModelInfo, newAcmNode ) {
        var self = this,
            newDomainModelNode,
            domainModelName = avmDomainModelInfo[ '@Name' ],
            domainModelType,
            xPos = parseInt( avmDomainModelInfo[ '@XPosition' ], 10 ),
            yPos = parseInt( avmDomainModelInfo[ '@YPosition' ], 10 ),
            modelicaClass;

        if ( !domainModelName ) {
            domainModelName = avmDomainModelInfo[ '@xsi:type' ].substr( avmDomainModelInfo[ '@xsi:type' ].indexOf(
                ':' ) + 1 );
        }

        newDomainModelNode = self.core.createNode( {
            parent: newAcmNode,
            base: MetaTypes.DomainModel
        } );
        self.core.setAttribute( newDomainModelNode, 'name', domainModelName );
        self.core.setRegistry( newDomainModelNode, 'position', {
            x: xPos,
            y: yPos
        } );

        if ( avmDomainModelInfo.hasOwnProperty( '@xsi:type' ) ) {
            domainModelType = avmDomainModelInfo[ '@xsi:type' ];

            if ( domainModelType === 'modelica:ModelicaModel' ) {
                self.core.setAttribute( newDomainModelNode, 'Type', 'Modelica' );
            } else if ( domainModelType === 'cad:CADModel' ) {
                self.core.setAttribute( newDomainModelNode, 'Type', 'CAD' );
            } else if ( domainModelType.indexOf( 'Manufacturing' ) > -1 ) {
                self.core.setAttribute( newDomainModelNode, 'Type', 'Manufacturing' );
            } else if ( domainModelType.indexOf( 'Cyber' ) > -1 ) {
                self.core.setAttribute( newDomainModelNode, 'Type', 'Cyber' );
            }
        }

        if ( avmDomainModelInfo.hasOwnProperty( '@Class' ) ) {
            modelicaClass = avmDomainModelInfo[ '@Class' ];
            self.core.setAttribute( newDomainModelNode, 'Class', modelicaClass );
        }
    };

    AcmImporter.prototype.createNewConnector = function ( avmConnInfo, newAcmNode ) {
        var self = this,
            connName = avmConnInfo[ '@Name' ],
            connId = avmConnInfo[ '@ID' ],
            xPos = parseInt( avmConnInfo[ '@XPosition' ], 10 ),
            yPos = parseInt( avmConnInfo[ '@YPosition' ], 10 ),
            domainConns,
            newConnectorNode = self.core.createNode( {
                parent: newAcmNode,
                base: MetaTypes.Connector
            } ),
            newDomainConnNode,
            i;

        self.core.setAttribute( newConnectorNode, 'name', connName );
        self.core.setAttribute( newConnectorNode, 'ID', connId );
        self.core.setRegistry( newConnectorNode, 'position', {
            x: xPos,
            y: yPos
        } );

        if ( avmConnInfo.hasOwnProperty( 'Role' ) ) {
            domainConns = avmConnInfo[ 'Role' ];

            for ( i = 0; i < domainConns.length; i += 1 ) {
                newDomainConnNode = self.createNewDomainPort( domainConns[ i ], newConnectorNode );

                self.core.setRegistry( newDomainConnNode, 'position', {
                    x: 200,
                    y: 200 + 100 * i
                } );
            }
        }

        return newConnectorNode;
    };

    AcmImporter.prototype.createNewDomainPort = function ( domainConnInfo, parentNode ) {
        var self = this,
            domainConnName = domainConnInfo[ '@Name' ],
            portID = domainConnInfo[ '@ID' ],
            domainConnType,
            newDomainConnNode = self.core.createNode( {
                parent: parentNode,
                base: MetaTypes.DomainPort
            } );

        if ( domainConnInfo.hasOwnProperty( '@xsi:type' ) ) {
            domainConnType = domainConnInfo[ '@xsi:type' ];

            if ( domainConnType === 'modelica:Connector' ) {
                self.core.setAttribute( newDomainConnNode, 'Type', 'ModelicaConnector' );

                if ( domainConnInfo.hasOwnProperty( '@Class' ) ) {
                    self.core.setAttribute( newDomainConnNode, 'Class', domainConnInfo[ '@Class' ] );
                }
            } else if ( domainConnType.indexOf( 'Axis' ) > -1 ) {
                self.core.setAttribute( newDomainConnNode, 'Type', 'CadAxis' );
            } else if ( domainConnType.indexOf( 'CoordinateSystem' ) > -1 ) {
                self.core.setAttribute( newDomainConnNode, 'Type', 'CadCoordinateSystem' );
            } else if ( domainConnType.indexOf( 'Plane' ) > -1 ) {
                self.core.setAttribute( newDomainConnNode, 'Type', 'CadPlane' );
            } else if ( domainConnType.indexOf( 'Point' ) > -1 ) {
                self.core.setAttribute( newDomainConnNode, 'Type', 'CadPoint' );
            }
        }

        self.core.setAttribute( newDomainConnNode, 'name', domainConnName );
        self.core.setAttribute( newDomainConnNode, 'ID', portID );

        return newDomainConnNode;
    };

    AcmImporter.prototype.createNewProperty = function ( avmPropInfo, newAcmNode ) {
        var self = this,
            propName = avmPropInfo[ '@Name' ],
            propId = avmPropInfo[ '@ID' ],
            xPos = parseInt( avmPropInfo[ '@XPosition' ], 10 ),
            yPos = parseInt( avmPropInfo[ '@YPosition' ], 10 ),
            avmValueInfo = self.getPropertyValue( avmPropInfo[ 'Value' ] ),
            dataType = avmPropInfo[ 'Value' ][ '@DataType' ],
            newAcmPropertyNode = self.core.createNode( {
                parent: newAcmNode,
                base: MetaTypes.Property
            } );
        if ( avmPropInfo[ 'Value' ][ '@Unit' ] ) {
            self.core.setAttribute( newAcmPropertyNode, 'Unit', avmPropInfo[ 'Value' ][ '@Unit' ] );
        }
        self.core.setAttribute( newAcmPropertyNode, 'name', propName );
        // This behaves like desktop GME importer, although the PrimitivePropertyInstance in adm files should reference the Property/@ID (but currently they refernece the Value/@ID)
        self.core.setAttribute( newAcmPropertyNode, 'ID', avmPropInfo.Value[ '@ID' ] );
        self.core.setAttribute( newAcmPropertyNode, 'Value', avmValueInfo.value );
        self.core.setAttribute( newAcmPropertyNode, 'Minimum', avmValueInfo.min );
        self.core.setAttribute( newAcmPropertyNode, 'Maximum', avmValueInfo.max );
        self.core.setAttribute( newAcmPropertyNode, 'ValueType', avmValueInfo.type );
        self.core.setAttribute( newAcmPropertyNode, 'DataType', dataType );
        self.core.setRegistry( newAcmPropertyNode, 'position', {
            x: xPos,
            y: yPos
        } );

        //self.propertyJson[propName] = avmPropInfo['Value'];

        self.id2NodeMap[ propId ] = newAcmPropertyNode;
        if ( avmPropInfo.Value ) {
            self.id2NodeMap[ avmPropInfo.Value[ '@ID' ] ] = newAcmPropertyNode;
        }
    };

    AcmImporter.prototype.getPropertyValue = function ( avmValueObject ) {
        var self = this,
            avmPropValueExpression,
            valueType,
            valueInfo = {
                min: '-inf',
                max: 'inf',
                default: '',
                value: '',
                type: 'Fixed'
            },
            srcId = 'src',
            dstId = 'dst';

        var getValueText = function ( valueObject ) {
            var valueAndText;

            if ( valueObject.hasOwnProperty( 'Value' ) ) {
                valueAndText = valueObject.Value;

                if ( valueAndText.hasOwnProperty( '#text' ) ) {
                    return valueAndText[ '#text' ];
                } else {
                    return '';
                }
            }
        };

        if ( avmValueObject.hasOwnProperty( 'ValueExpression' ) ) {
            avmPropValueExpression = avmValueObject[ 'ValueExpression' ];

            if ( avmPropValueExpression.hasOwnProperty( '@xsi:type' ) ) {
                valueType = avmPropValueExpression[ '@xsi:type' ];

                if ( valueType === 'avm:ParametricValue' ) {
                    valueInfo.type = 'Parametric';

                    if ( avmPropValueExpression.hasOwnProperty( 'Minimum' ) ) {
                        valueInfo.min = getValueText( avmPropValueExpression.Minimum );
                    }
                    if ( avmPropValueExpression.hasOwnProperty( 'Maximum' ) ) {
                        valueInfo.max = getValueText( avmPropValueExpression.Maximum );
                    }
                    if ( avmPropValueExpression.hasOwnProperty( 'AssignedValue' ) ) {
                        valueInfo.value = getValueText( avmPropValueExpression.AssignedValue );
                    }
                    if ( avmPropValueExpression.hasOwnProperty( 'Default' ) ) {
                        valueInfo.
                        default = getValueText( avmPropValueExpression.Default );
                    } else {
                        valueInfo.
                        default = valueInfo.value;
                    }
                } else if ( valueType === 'avm:FixedValue' ) {
                    valueInfo.value = getValueText( avmPropValueExpression );
                    valueInfo.
                    default = valueInfo.value;
                } else if ( valueType === 'avm:DerivedValue' ) {
                    if ( avmValueObject.hasOwnProperty( '@ID' ) ) {
                        dstId = avmValueObject[ '@ID' ];
                    }
                    if ( avmPropValueExpression.hasOwnProperty( '@ValueSource' ) ) {
                        srcId = avmPropValueExpression[ '@ValueSource' ];
                    }

                    if ( self.valueFlowIdMap.hasOwnProperty( srcId ) ) {
                        self.valueFlowIdMap[ srcId ].push( dstId );
                    } else {
                        self.valueFlowIdMap[ srcId ] = [ dstId ];
                    }
                }
            }
        }

        valueInfo.value = valueInfo.value || '';
        return valueInfo;
    };

    AcmImporter.prototype.createNewFormula = function ( avmFormulaInfo, newAcmNode ) {
        var self = this,
            formulaName = avmFormulaInfo[ '@Name' ],
            formulaId = avmFormulaInfo[ '@ID' ],
            xPos = parseInt( avmFormulaInfo[ '@XPosition' ], 10 ),
            yPos = parseInt( avmFormulaInfo[ '@YPosition' ], 10 ),
            formulaType = avmFormulaInfo[ '@xsi:type' ],
            operationType,
            expression,
            operand,
            sourceIDs,
            sourceID,
            newFormulaNode,
            i;

        if ( formulaType === 'avm:SimpleFormula' ) {
            newFormulaNode = self.core.createNode( {
                parent: newAcmNode,
                base: MetaTypes.SimpleFormula
            } );

            if ( avmFormulaInfo.hasOwnProperty( '@Operation' ) ) {
                operationType = avmFormulaInfo[ '@Operation' ];
                self.core.setAttribute( newFormulaNode, 'Method', operationType );
            }
            if ( avmFormulaInfo.hasOwnProperty( '@Operand' ) ) {
                operand = avmFormulaInfo[ '@Operand' ];
                sourceIDs = operand.split( ' ' );

                for ( i = 0; i < sourceIDs.length; i += 1 ) {
                    if ( self.valueFlowIdMap.hasOwnProperty( sourceIDs[ i ] ) ) {
                        self.valueFlowIdMap[ sourceIDs[ i ] ].push( formulaId );
                    } else {
                        self.valueFlowIdMap[ sourceIDs[ i ] ] = [ formulaId ];
                    }
                }
            }
        } else if ( formulaType === 'avm:ComplexFormula' ) {
            newFormulaNode = self.core.createNode( {
                parent: newAcmNode,
                base: MetaTypes.CustomFormula
            } );

            if ( avmFormulaInfo.hasOwnProperty( '@Expression' ) ) {
                expression = avmFormulaInfo[ '@Expression' ];
                self.core.setAttribute( newFormulaNode, 'Expression', expression );
            }
            if ( avmFormulaInfo.hasOwnProperty( 'Operand' ) ) {
                operand = avmFormulaInfo[ 'Operand' ];

                for ( i = 0; i < operand.length; i += 1 ) {
                    if ( operand[ i ].hasOwnProperty( '@ValueSource' ) ) {
                        sourceID = operand[ i ][ '@ValueSource' ];

                        if ( self.valueFlowIdMap.hasOwnProperty( sourceID ) ) {
                            self.valueFlowIdMap[ sourceID ].push( formulaId );
                        } else {
                            self.valueFlowIdMap[ sourceID ] = [ formulaId ];
                        }
                    }
                }
            }
        }

        self.core.setAttribute( newFormulaNode, 'name', formulaName );
        self.core.setRegistry( newFormulaNode, 'position', {
            x: xPos,
            y: yPos
        } );

        self.id2NodeMap[ formulaId ] = newFormulaNode;
    };

    AcmImporter.prototype.makeValueFlows = function ( valueFlowMap, newAcmNode ) {
        var self = this,
            newValueFlowNode,
            srcId,
            dstIds,
            dstId,
            srcNode,
            dstNode;

        for ( srcId in valueFlowMap ) {
            if ( self.id2NodeMap.hasOwnProperty( srcId ) ) {
                srcNode = self.id2NodeMap[ srcId ];
            } else {
                continue;
            }

            dstIds = valueFlowMap[ srcId ];

            for ( var i = 0; i < dstIds.length; i += 1 ) {
                dstId = dstIds[ i ];

                if ( self.id2NodeMap.hasOwnProperty( dstId ) ) {
                    dstNode = self.id2NodeMap[ dstId ];

                    newValueFlowNode = self.core.createNode( {
                        parent: newAcmNode,
                        base: MetaTypes.ValueFlowComposition
                    } );
                    self.core.setPointer( newValueFlowNode, 'src', srcNode );
                    self.core.setPointer( newValueFlowNode, 'dst', dstNode );
                } else {
                    continue;
                }
            }
        }
    };

    AcmImporter.prototype.getAcmDetails = function ( fileHash, getAcmCallback ) {
        var self = this,
            blobGetMetadataCallback = function ( getMetadataErr, metadata ) {
                if ( getMetadataErr ) {
                    getAcmCallback( getMetadataErr );
                    return;
                }

                var content = metadata[ 'content' ],
                    contentName = metadata[ 'name' ],
                    contentType = metadata[ 'contentType' ],
                    single = false,
                    multi = false,
                    hashToAcmJsonMap = {},
                    blobGetObjectCallback;

                if ( contentType === 'complex' ) {
                    multi = true;
                } else if ( contentType === 'object' && contentName.indexOf( '.zip' ) > -1 ) {
                    single = true;
                } else {
                    var msg = 'Uploaded file "' + contentName + '" was not valid.';
                    self.createMessage( self.activeNode, msg, 'error' );
                    self.logger.error( msg );
                    getAcmCallback( msg );
                    return;
                }

                blobGetObjectCallback = function ( getObjectErr, uploadedObjContent ) {
                    if ( getObjectErr ) {
                        getAcmCallback( getObjectErr );
                        return;
                    }

                    var zipFile = new JSZip( uploadedObjContent ),
                        acmObjects,
                        acmObject,
                        acmContent,
                        acmZipFileName,
                        acmHash,
                        acmZipFile,
                        numberAcmFiles,
                        acmJson;

                    if ( single ) {
                        acmJson = self.getAcmJsonFromZip( zipFile, contentName );

                        if ( acmJson != null ) {
                            hashToAcmJsonMap[ fileHash ] = acmJson;
                        }

                        //hashToAcmJsonMap[fileHash] = self.getAcmJsonFromZip(zipFile, contentName);

                    } else if ( multi ) {

                        acmObjects = zipFile.file( /\.zip/ );
                        numberAcmFiles = acmObjects.length;

                        for ( var i = 0; i < numberAcmFiles; i += 1 ) {
                            acmObject = acmObjects[ i ];
                            acmZipFileName = acmObject.name;
                            acmContent = acmObject.asArrayBuffer();
                            acmZipFile = new JSZip( acmContent );
                            acmHash = content[ acmZipFileName ].content; // blob 'soft-link' hash

                            acmJson = self.getAcmJsonFromZip( acmZipFile, acmZipFileName );

                            if ( acmJson != null ) {
                                hashToAcmJsonMap[ acmHash ] = acmJson;
                            }
                        }

                    }

                    getAcmCallback( null, hashToAcmJsonMap );
                };

                self.blobClient.getObject( fileHash, blobGetObjectCallback );
            };

        self.blobClient.getMetadata( fileHash, blobGetMetadataCallback );
    };

    AcmImporter.prototype.getAcmJsonFromZip = function ( acmZip, acmZipName ) {
        var self = this,
            converterResult,
            acmName = acmZipName.split( '.' )[ 0 ],
            acmXml = acmZip.file( /\.acm/ ),
            msg;

        if ( acmXml.length === 1 ) {
            converterResult = self.convertXmlString2Json( acmXml[ 0 ].asText() );

            if ( converterResult instanceof Error ) {
                msg = '.acm file in "' + acmZipName + '" is not a valid xml.';
                self.logger.error( msg );
                self.createMessage( null, msg, 'error' );
                self.cleanImport = false;
                return null;
            } else {
                return converterResult;
            }
        } else if ( acmXml.length === 0 ) {
            msg = 'No .acm file found inside ' + acmZipName + '.';
            self.logger.error( msg );
            self.createMessage( null, msg, 'error' );
            self.cleanImport = false;
            return null;
        } else {
            msg = 'Found multiple .acm files in ' + acmZipName + '. Only one was expected.';
            self.logger.error( msg );
            self.createMessage( null, msg, 'error' );
            converterResult = self.convertXmlString2Json( acmXml[ 0 ].asText() );

            if ( converterResult instanceof Error ) {
                msg = '.acm file in ' + acmZipName + ' is not a valid xml.';
                self.logger.error( msg );
                self.createMessage( null, msg, 'error' );
                self.cleanImport = false;
                return null;
            } else {
                return converterResult;
            }
        }
    };

    AcmImporter.prototype.convertXmlString2Json = function ( acmXmlString ) {
        var self = this,
            converter = new Xml2Json.Xml2json( {
                skipWSText: true,
                arrayElements: {
                    Property: true,
                    Connector: true,
                    DomainModel: true,
                    Role: true,
                    Formula: true,
                    Operand: true,
                    Port: true
                }
            } );

        return converter.convertFromString( acmXmlString );
    };

    return AcmImporter;
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/AdmImporter/AdmImporter/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/**
 * Generated by PluginGenerator from webgme on Mon Apr 14 2014 10:15:45 GMT-0500 (Central Daylight Time).
 */
// TODO: Get the json data dynamically!
define( 'plugin/AdmImporter/AdmImporter/AdmImporter',[
    'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/AdmImporter/AdmImporter/meta',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, MetaTypes, Converter ) {
    
    //<editor-fold desc="============================ Class Definition ================================">
    /**
     * Initializes a new instance of AdmImporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin AdmImporter.
     * @constructor
     */
    var AdmImporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = MetaTypes;
        this.acmCounter = 0;
        this.componentID2Acm = {};
        this.componentID2PrintInfo = {};
        // printInfoDataType = {
        //    name: {string},
        //    count: {int},
        //    parentName: {string}
        // };
        this.componentInstances = [];
        //        componentInstancesDataType = {
        //            node: {nodeObj},
        //            connIdInModel2ID: {object},
        //            propertyIdInModel2ID: {object},
        //            portIdInModel2ID: {object},
        //        };
        this.connID2Node = {};
        this.portID2Node = {};
        this.valueFlowTargetID2Node = {};
        this.valueFlows = [];
        //        valueFlowsDataType = {
        //            src: {string},
        //            dst: {string}
        //        };
        this.valueFlowMuxes = {};
        this.connectorCompositions = [];
        //        connectorCompositionsDataType = {
        //            src: {string},
        //            dst: {string}
        //        };
        this.portMaps = [];
        //        portMapsDataType = {
        //            src: {string},
        //            dst: {string}
        //        };
        this.admData = null;
        this.copies = false;
        this.currentSuccess = true;
    };

    // Prototypal inheritance from PluginBase.
    AdmImporter.prototype = Object.create( PluginBase.prototype );
    AdmImporter.prototype.constructor = AdmImporter;

    /**
     * Gets the name of the AdmImporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    AdmImporter.prototype.getName = function () {
        return "ADM Importer";
    };

    /**
     * Gets the description of the AdmImporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    AdmImporter.prototype.getDescription = function () {
        return "Imports an adm-file generated from desktop GME.";
    };

    /**
     * Gets the semantic version (semver.org) of the AdmImporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    AdmImporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the configuration structure for the AdmImporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    AdmImporter.prototype.getConfigStructure = function () {
        return [ {
            'name': 'admFile',
            'displayName': 'ADM file',
            'description': 'AVM Design Model.',
            'value': "",
            'valueType': 'asset',
            'readOnly': false
        } ];
    };
    //</editor-fold>
    AdmImporter.prototype.innerMain = function ( xmlArrayBuffer, callback, finnishPlugin ) {
        var self = this,
            xml2json = new Converter.Xml2json( {
                skipWSText: true,
                arrayElements: self.arrayElementsInXml
            } ),
            admFolder = self.activeNode,
            workspaceNode;

        self.updateMETA( self.meta );
        //self.copies = config.copies;
        self.copies = true;
        if ( typeof xmlArrayBuffer === 'string' ) {
            self.admData = xml2json.convertFromString( xmlArrayBuffer );
        } else {
            self.admData = xml2json.convertFromBuffer( xmlArrayBuffer );
        }
        if ( self.admData instanceof Error ) {
            self.createMessage( null, 'Given adm not valid xml: ' + self.admData.message, 'error' );
            callback( null, self.result );
            return;
        }

        self.admData = self.admData[ 'Design' ];
        workspaceNode = self.getWorkspaceNode( admFolder );
        //timeStamp = new Date().getTime();
        self.exploreACMs( workspaceNode, false, function ( err ) {
            if ( err ) {
                callback( err, self.result );
                return;
            }
            //self.createMessage(null, 'ExecTime [s] exploreACMs     :: ' +
            //        ((new Date().getTime() - timeStamp) / 1000).toString());
            if ( self.acmCounter > 0 ) {
                self.createMessage( workspaceNode, 'Work-space did not have all ACMs used by the design.',
                    'error' );
                self.logMissingACMsToResult();
                callback( null, self.result );
                return;
            }
            //timeStamp = new Date().getTime();
            self.container = self.createAdmDesign( admFolder );
            //self.createMessage(null, 'ExecTime [s] createAdmDesign :: ' +
            //    ((new Date().getTime() - timeStamp) / 1000).toString());
            if ( false ) {
                self.makeConnectorCompositions();
                self.makeValueFlows();
                finnishPlugin( null );
            } else {
                //timeStamp = new Date().getTime();
                self.gatherComponentInstanceContent( function ( err ) {
                    //self.createMessage(null, 'ExecTime [s] gatherComponentInstanceContent :: ' +
                    //    ((new Date().getTime() - timeStamp) / 1000).toString());
                    if ( err ) {
                        finnishPlugin( err );
                    } else {
                        //timeStamp = new Date().getTime();
                        self.makeConnectorCompositions();
                        //self.createMessage(null, 'ExecTime [s] makeConnectorCompositions :: ' +
                        //    ((new Date().getTime() - timeStamp) / 1000).toString());
                        //timeStamp = new Date().getTime();
                        self.makeValueFlows();
                        //self.createMessage(null, 'ExecTime [s] makeValueFlows :: ' +
                        //    ((new Date().getTime() - timeStamp) / 1000).toString());
                        self.makePortMaps();
                        finnishPlugin( null );
                    }
                } );
            }
        } );
    };

    AdmImporter.prototype.arrayElementsInXml = {
        Design: false,
        RootContainer: false,
        Value: false,
        Container: true,
        Connector: true,
        Property: true,
        Formula: true,
        Operand: true,
        ValueFlowMux: true,
        ComponentInstance: true,
        PrimitivePropertyInstance: true,
        ConnectorInstance: true,
        PortInstance: true,
        Role: true,
        Port: true
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always have to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    AdmImporter.prototype.main = function ( callback ) {
        var self = this,
            config = self.getCurrentConfig(),
            //timeStamp,
            timeStart = new Date()
                .getTime(),
            debug = false,
            finnishPlugin = function ( err ) {
                if ( err ) {
                    callback( err, self.result );
                    return;
                }

                if ( debug ) {
                    self.saveDebugArtifacts( callback );
                } else {
                    //timeStamp = new Date().getTime();
                    self.save( 'added obj', function ( err ) {
                        if ( err ) {
                            callback( err, self.result );
                            return;
                        }
                        //self.createMessage(null, 'ExecTime [s] save :: ' +
                        //    ((new Date().getTime() - timeStamp) / 1000).toString());

                        if ( self.currentSuccess === false ) {
                            self.createMessage( null,
                                'There were issues in the matched ACMs. Incomplete model still ' +
                                'imported - make sure to address the reported issues.', 'warning' );
                        }
                        //                        self.createMessage(null, 'ExecTime [s] total :: ' +
                        //                            ((new Date().getTime() - timeStart) / 1000).toString());
                        self.result.setSuccess( self.currentSuccess );
                        callback( null, self.result );
                    } );
                }
            };

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }

        if ( self.isMetaTypeOf( self.activeNode, self.META.ADMFolder ) === false ) {
            self.createMessage( null, 'This plugin must be called from an ADMFolder.', 'error' );
            callback( null, self.result );
            return;
        }
        if ( !config.admFile ) {
            self.createMessage( null, 'No adm file provided', 'error' );
            callback( null, self.result );
            return;
        }
        self.blobClient.getObject( config.admFile, function ( err, xmlArrayBuffer ) {
            self.innerMain( xmlArrayBuffer, callback, finnishPlugin );
        } );
    };

    AdmImporter.prototype.saveDebugArtifacts = function ( callback ) {
        var self = this,
            artie,
            json2xml,
            debugFiles;

        json2xml = new Converter.Json2xml();
        debugFiles = {
            'design.json': JSON.stringify( {
                Design: self.admData
            }, null, 4 ),
            'design.adm': json2xml.convertToString( {
                Design: self.admData
            } )
        };
        artie = self.blobClient.createArtifact( 'debugFiles' );
        artie.addFiles( debugFiles, function ( err, hashes ) {
            if ( err ) {
                self.result.setSuccess( false );
                callback( 'Could not add debug files : err' + err.toString(), self.result );
                return;
            }
            artie.save( function ( err, hash ) {
                if ( err ) {
                    self.result.setSuccess( false );
                    callback( 'Could not save artifact : err' + err.toString(), self.result );
                    return;
                }
                self.result.setSuccess( true );
                self.result.addArtifact( hash );
                callback( null, self.result );
            } );
        } );
    };

    //<editor-fold desc="============================ Gathering of ACM Info ===========================">
    AdmImporter.prototype.getWorkspaceNode = function ( node ) {
        var self = this;
        while ( node ) {
            if ( self.isMetaTypeOf( node, self.meta.WorkSpace ) ) {
                self.logger.info( 'Found WorkSpace-Node : ' + self.core.getAttribute( node, 'name' ) );
                return node;
            }
            node = self.core.getParent( node );
        }
        self.logger.error( 'Could not find WorkSpace!!' );
    };

    AdmImporter.prototype.exploreACMs = function ( node, dummyACMs, callback ) {
        var self = this;
        if ( dummyACMs ) {
            callback( null );
            return;
        }
        self.initializeComponentMap( self.admData.RootContainer );
        self.logger.info( 'Number of unique ACMs (acmCounter) is ' + self.acmCounter.toString() );
        self.core.loadChildren( node, function ( err, children ) {
            var counter,
                i,
                counterCallback,
                error = '';
            // Check for error in loading before doing recursion.
            if ( err ) {
                callback( 'Could not load children for project, err: ' + err, self.result );
                return;
            }
            if ( children.length === 0 ) {
                callback( null );
                return;
            }
            // Define a counter and callback for the recursion.
            counter = {
                visits: children.length
            };
            counterCallback = function ( err ) {
                error = err ? error += err : error;
                counter.visits -= 1;
                if ( counter.visits === 0 ) {
                    callback( error );
                }
            };
            // Iterate over children and invoke recursion on ACMFolders.
            for ( i = 0; i < children.length; i += 1 ) {
                if ( self.isMetaTypeOf( children[ i ], self.meta.ACMFolder ) ) {
                    self.visitComponentsRec( children[ i ], counter, counterCallback );
                } else {
                    counterCallback( null );
                }
            }
        } );
    };

    AdmImporter.prototype.initializeComponentMap = function ( container ) {
        var self = this,
            i,
            subContainers,
            components,
            id;

        if ( container.ComponentInstance ) {
            components = container.ComponentInstance;
            for ( i = 0; i < components.length; i += 1 ) {
                id = components[ i ][ '@ComponentID' ];
                if ( self.componentID2Acm[ id ] === undefined ) {
                    self.componentID2Acm[ id ] = false;
                    self.acmCounter += 1;
                    self.componentID2PrintInfo[ id ] = {
                        name: components[ i ][ '@Name' ],
                        count: 1,
                        parentName: container[ '@Name' ]
                    };
                } else {
                    self.componentID2PrintInfo[ id ].count += 1;
                }
            }
        }

        if ( container.Container ) {
            subContainers = container.Container;
            for ( i = 0; i < subContainers.length; i += 1 ) {
                self.initializeComponentMap( subContainers[ i ] );
            }
        }
    };

    AdmImporter.prototype.visitComponentsRec = function ( node, counter, callback ) {
        var self = this,
            name = self.core.getAttribute( node, 'name' ),
            childName;
        self.logger.info( 'visitComponentsRec at node "' + name + '" acmCounter is:   ' + self.acmCounter.toString() );
        if ( self.acmCounter <= 0 ) {
            callback( null );
            return;
        }
        self.core.loadChildren( node, function ( err, children ) {
            var i,
                componentID;
            if ( err ) {
                callback( ' loadChildren failed for component ' + name + ' with error : ' + err );
                return;
            }
            counter.visits += children.length;

            if ( children.length === 0 ) {
                // The only chance for callback to be called.
                callback( null );
            } else {
                // The node needs to be accounted for.
                counter.visits -= 1;
            }
            for ( i = 0; i < children.length; i += 1 ) {
                if ( self.isMetaTypeOf( children[ i ], self.meta.ACMFolder ) ) {
                    self.visitComponentsRec( children[ i ], counter, callback );
                } else if ( self.isMetaTypeOf( children[ i ], self.meta.AVMComponentModel ) ) {
                    componentID = self.core.getAttribute( children[ i ], 'ID' );
                    childName = self.core.getAttribute( children[ i ], 'name' );
                    if ( self.componentID2Acm[ componentID ] === false ) {
                        self.componentID2Acm[ componentID ] = children[ i ];
                        self.logger.info( 'Found matching ACM "' + childName + '"' );
                        self.acmCounter -= 1;
                    } else if ( self.componentID2Acm[ componentID ] === undefined ) {
                        self.logger.info( 'ACM "' + childName + '" is not part of the design.' );
                    } else {
                        self.logger.warning( 'Found duplicate ACM ID "' + componentID + '". "' + childName +
                            '" at "' +
                            self.core.getPath( children[ i ] ) + '" will not be used.' );
                    }
                    callback( null );
                } else {
                    callback( null );
                }
            }
        } );
    };

    AdmImporter.prototype.logMissingACMsToResult = function () {
        var self = this,
            missingIDs = [],
            key,
            i,
            info;
        for ( key in self.componentID2Acm ) {
            if ( self.componentID2Acm.hasOwnProperty( key ) ) {
                if ( self.componentID2Acm[ key ] === false ) {
                    missingIDs.push( key );
                }
            }
        }
        for ( i = 0; i < missingIDs.length; i += 1 ) {
            info = self.componentID2PrintInfo[ missingIDs[ i ] ];
            self.createMessage( null, 'ACM "' + info.name + '", in ADM "' + info.parentName + '" did not have a ' +
                'matching ACM with ID "' + missingIDs[ i ] + '". (The component ocurres ' + info.count.toString() +
                ' times in the ADM.)', 'error' );
        }
    };
    //</editor-fold>

    //<editor-fold desc="=========================== Creation of ADM objects ==========================">
    AdmImporter.prototype.createAdmDesign = function ( admFolder ) {
        var self = this;
        return self.createContainer( self.admData.RootContainer, admFolder, 0 );
    };

    AdmImporter.prototype.createContainer = function ( containerData, parentNode, depth ) {
        var self = this,
            container,
            subContainersData,
            componentsData,
            connectorsData,
            portData,
            propertiesData,
            formulasData,
            muxData,
            i,
            indent = new Array( depth + 2 )
                .join( '-' );
        // Create the container and set attributes and registry.
        container = self.core.createNode( {
            parent: parentNode,
            base: self.meta.Container
        } );
        self.core.setAttribute( container, 'name', containerData[ '@Name' ] );
        self.core.setAttribute( container, 'Type', containerData[ '@xsi:type' ].slice( "avm:".length ) );
        if ( depth === 0 ) {
            self.core.setRegistry( container, 'position', {
                x: 100,
                y: 100
            } );
        } else {
            self.core.setRegistry( container, 'position', {
                x: parseInt( containerData[ '@XPosition' ], 10 ),
                y: parseInt( containerData[ '@YPosition' ], 10 )
            } );
        }

        self.logger.info( indent + 'Created Container : ' + containerData[ '@Name' ] );
        depth += 1;

        // Go through the containment and add the child-objects.
        if ( containerData.Container ) {
            subContainersData = containerData.Container;
            for ( i = 0; i < subContainersData.length; i += 1 ) {
                self.createContainer( subContainersData[ i ], container, depth );
            }
        }

        if ( containerData.ValueFlowMux ) {
            muxData = containerData.ValueFlowMux;
            for ( i = 0; i < muxData.length; i += 1 ) {
                self.valueFlowMuxes[ muxData[ i ][ '@ID' ] ] = muxData[ i ][ '@Source' ].split( ' ' );
            }
        }

        if ( containerData.ComponentInstance ) {
            componentsData = containerData.ComponentInstance;
            for ( i = 0; i < componentsData.length; i += 1 ) {
                self.createComponent( componentsData[ i ], container );
                self.logger.info( indent + 'Created Component : ' + componentsData[ i ][ '@Name' ] );
            }
        }

        if ( containerData.Connector ) {
            connectorsData = containerData.Connector;
            for ( i = 0; i < connectorsData.length; i += 1 ) {
                self.createConnector( connectorsData[ i ], container );
                self.logger.info( indent + 'Created Connector : ' + connectorsData[ i ][ '@Name' ] );
            }
        }

        if ( containerData.Port ) {
            portData = containerData.Port;
            for ( i = 0; i < portData.length; i += 1 ) {
                self.createDomainPort( portData[ i ], container );
                self.logger.info( indent + 'Created DomainPort : ' + portData[ i ][ '@Name' ] );
            }
        }

        if ( containerData.Property ) {
            propertiesData = containerData.Property;
            for ( i = 0; i < propertiesData.length; i += 1 ) {
                self.createProperty( propertiesData[ i ], container );
            }
        }

        if ( containerData.Formula ) {
            formulasData = containerData.Formula;
            for ( i = 0; i < formulasData.length; i += 1 ) {
                self.createFormula( formulasData[ i ], container );
            }
        }

        return container;
    };

    AdmImporter.prototype.createComponent = function ( componentData, parentNode ) {
        var self = this,
            i,
            avmID = componentData[ '@ComponentID' ],
            component,
            connectorInstanceData = componentData.ConnectorInstance,
            connector,
            connectorIdInModel,
            connectorId,
            connIdInModel2ID = {},
            primitivePropertyData = componentData.PrimitivePropertyInstance,
            property,
            propertyIdInModel,
            propertyId,
            propertyIdInModel2ID = {},
            portInstanceData = componentData.PortInstance,
            port,
            portIdInModel,
            portId,
            portIdInModel2ID = {};

        if ( self.componentID2Acm[ avmID ] ) {
            self.logger.info( 'Found ACM for : ' + componentData[ '@Name' ] );
            if ( self.copies ) {
                component = self.core.copyNode( self.componentID2Acm[ avmID ], parentNode );
            } else {
                component = self.core.createNode( {
                    parent: parentNode,
                    base: self.componentID2Acm[ avmID ]
                } );
            }
            if ( connectorInstanceData ) {
                for ( i = 0; i < connectorInstanceData.length; i += 1 ) {
                    connectorIdInModel = connectorInstanceData[ i ][ '@IDinComponentModel' ];
                    connectorId = connectorInstanceData[ i ][ '@ID' ];
                    self.addConnectionData( parentNode, connectorInstanceData[ i ] );
                    connIdInModel2ID[ connectorIdInModel ] = connectorId;
                }
            }
            if ( portInstanceData ) {
                for ( i = 0; i < portInstanceData.length; i += 1 ) {
                    portIdInModel = portInstanceData[ i ][ '@IDinComponentModel' ];
                    portId = portInstanceData[ i ][ '@ID' ];
                    self.addPortMapData( parentNode, portInstanceData[ i ] );
                    portIdInModel2ID[ portIdInModel ] = portId;
                }
            }
            if ( primitivePropertyData ) {
                for ( i = 0; i < primitivePropertyData.length; i += 1 ) {
                    propertyIdInModel = primitivePropertyData[ i ][ '@IDinComponentModel' ];
                    propertyId = primitivePropertyData[ i ].Value[ '@ID' ];
                    if ( primitivePropertyData[ i ].Value.ValueExpression ) {
                        self.valueFlows.push( {
                            src: primitivePropertyData[ i ].Value.ValueExpression[ '@ValueSource' ],
                            dst: propertyId
                        } );
                    }
                    // TODO: this is not a good way to do this...
                    propertyIdInModel2ID[ propertyIdInModel ] = propertyId;
                }
            }
            self.componentInstances.push( {
                node: component,
                connIdInModel2ID: connIdInModel2ID,
                propertyIdInModel2ID: propertyIdInModel2ID,
                portIdInModel2ID: portIdInModel2ID
            } );
        } else {
            self.logger.warning( 'Could not find ACM for ComponentInstance : ' + componentData[ '@Name' ] );
            self.logger.warning( 'Will create an empty shell model in design from avaliable data.' );
            component = self.core.createNode( {
                parent: parentNode,
                base: self.meta.AVMComponentModel
            } );
            self.core.setAttribute( component, 'ID', avmID );
            if ( connectorInstanceData ) {
                for ( i = 0; i < connectorInstanceData.length; i += 1 ) {
                    connectorIdInModel = connectorInstanceData[ i ][ '@IDinComponentModel' ];
                    connectorId = connectorInstanceData[ i ][ '@ID' ];
                    self.addConnectionData( parentNode, connectorInstanceData[ i ] );
                    // Create a dummy-connector in the dummy-component.
                    connector = self.core.createNode( {
                        parent: component,
                        base: self.meta.Connector
                    } );
                    self.core.setAttribute( connector, 'name', 'PortDummy' + i.toString() );
                    self.core.setAttribute( connector, 'ID', connectorIdInModel );
                    self.core.setRegistry( connector, 'position', {
                        x: 400,
                        y: ( 1 + i ) * 70
                    } );

                    self.connID2Node[ connectorId ] = connector;
                }
            }
            if ( primitivePropertyData ) {
                for ( i = 0; i < primitivePropertyData.length; i += 1 ) {
                    propertyId = primitivePropertyData[ i ].Value[ '@ID' ];
                    propertyIdInModel = primitivePropertyData[ i ][ '@IDinComponentModel' ];
                    if ( primitivePropertyData[ i ].Value.ValueExpression ) {
                        self.valueFlows.push( {
                            src: primitivePropertyData[ i ].Value.ValueExpression[ '@ValueSource' ],
                            dst: propertyId
                        } );
                    }
                    // Create a dummy-property in the dummy-component.
                    property = self.core.createNode( {
                        parent: component,
                        base: self.meta.Property
                    } );
                    self.core.setRegistry( property, 'position', {
                        x: 100,
                        y: ( 1 + i ) * 70
                    } );
                    self.core.setAttribute( property, 'name', 'PropertyDummy' + i.toString() );
                    self.core.setAttribute( property, 'ID', propertyIdInModel );

                    self.valueFlowTargetID2Node[ propertyId ] = property;
                }
            }
            self.createMessage( component, '"' + componentData[ '@Name' ] + '" is just a dummy..' );
        }

        self.core.setAttribute( component, 'name', componentData[ '@Name' ] );
        self.core.setRegistry( component, 'position', {
            x: parseInt( componentData[ '@XPosition' ], 10 ),
            y: parseInt( componentData[ '@YPosition' ], 10 )
        } );
    };

    AdmImporter.prototype.createConnector = function ( connectorData, parentNode ) {
        var self = this,
            i,
            connector;

        connector = self.core.createNode( {
            parent: parentNode,
            base: self.meta.Connector
        } );
        self.connID2Node[ connectorData[ '@ID' ] ] = connector;
        self.core.setAttribute( connector, 'name', connectorData[ '@Name' ] );
        // Add Domain-Connectors (Role in adm).
        if ( connectorData.Role ) {
            for ( i = 0; i < connectorData.Role.length; i += 1 ) {
                self.createDomainPort( connectorData.Role[ i ], connector );
            }
        }

        self.core.setRegistry( connector, 'position', {
            x: parseInt( connectorData[ '@XPosition' ], 10 ),
            y: parseInt( connectorData[ '@YPosition' ], 10 )
        } );

        self.addConnectionData( parentNode, connectorData );
    };

    AdmImporter.prototype.createDomainPort = function ( portData, parentNode ) {
        var self = this,
            port,
            typeName;
        port = self.core.createNode( {
            parent: parentNode,
            base: self.meta.DomainPort
        } );

        self.core.setAttribute( port, 'name', portData[ '@Name' ] );

        typeName = portData[ '@xsi:type' ];

        if ( self.endsWith( typeName, 'Connector' ) ) {
            if ( portData.hasOwnProperty( '@Class' ) ) {
                self.core.setAttribute( port, 'Type', 'ModelicaConnector' );
                self.core.setAttribute( port, 'Class', portData[ '@Class' ] );
            } else {
                self.createMessage( port, 'Domain port was of xsi:type Connector but did not ' +
                    'have a Class defined. Unknown Type: ' + JSON.stringify( portData, null, 2 ), 'error' );
            }
        } else if ( self.endsWith( typeName, 'Axis' ) ) {
            self.core.setAttribute( port, 'Type', 'CadAxis' );
        } else if ( self.endsWith( typeName, 'CoordinateSystem' ) ) {
            self.core.setAttribute( port, 'Type', 'CadCoordinateSystem' );
        } else if ( self.endsWith( typeName, 'Plane' ) ) {
            self.core.setAttribute( port, 'Type', 'CadPlane' );
        } else if ( self.endsWith( typeName, 'Point' ) ) {
            self.core.setAttribute( port, 'Type', 'CadPoint' );
        } else {
            self.createMessage( port, 'Unknown Type for domain port : ' + JSON.stringify( portData, null, 2 ),
                'error' );
        }

        self.core.setRegistry( port, 'position', {
            x: parseInt( portData[ '@XPosition' ], 10 ),
            y: parseInt( portData[ '@YPosition' ], 10 )
        } );

        self.portID2Node[ portData[ '@ID' ] ] = port;
        self.addPortMapData( parentNode, portData );
    };

    AdmImporter.prototype.createProperty = function ( propertyData, parentNode ) {
        var self = this,
            i,
            muxSources,
            property,
            value = '',
            isParameter = false,
            valueExpression,
            assignedValue,
            valueID = propertyData.Value[ '@ID' ];

        if ( propertyData.Value.ValueExpression ) {
            valueExpression = propertyData.Value.ValueExpression;
            if ( self.endsWith( valueExpression[ '@xsi:type' ], 'ParametricValue' ) ) {
                isParameter = true;
                assignedValue = valueExpression.AssignedValue;
                if ( self.endsWith( assignedValue[ '@xsi:type' ], 'FixedValue' ) ) {
                    if ( assignedValue.Value && assignedValue.Value[ '#text' ] ) {
                        value = valueExpression.AssignedValue.Value[ '#text' ];
                    }
                } else if ( self.endsWith( assignedValue[ '@xsi:type' ], 'DerivedValue' ) ) {
                    if ( self.valueFlowMuxes[ assignedValue[ '@ValueSource' ] ] ) {
                        muxSources = self.valueFlowMuxes[ assignedValue[ '@ValueSource' ] ];
                        for ( i = 0; i < muxSources.length; i += 1 ) {
                            self.valueFlows.push( {
                                src: muxSources[ i ],
                                dst: valueID
                            } );
                        }
                    } else {
                        self.valueFlows.push( {
                            src: assignedValue[ '@ValueSource' ],
                            dst: valueID
                        } );
                    }
                }
            } else if ( self.endsWith( valueExpression[ '@xsi:type' ], 'FixedValue' ) ) {
                if ( valueExpression.Value && valueExpression.Value[ '#text' ] ) {
                    value = valueExpression.Value[ '#text' ];
                }
            } else if ( self.endsWith( valueExpression[ '@xsi:type' ], 'DerivedValue' ) ) {
                if ( self.valueFlowMuxes[ valueExpression[ '@ValueSource' ] ] ) {
                    muxSources = self.valueFlowMuxes[ valueExpression[ '@ValueSource' ] ];
                    for ( i = 0; i < muxSources.length; i += 1 ) {
                        self.valueFlows.push( {
                            src: muxSources[ i ],
                            dst: valueID
                        } );
                    }
                } else {
                    self.valueFlows.push( {
                        src: valueExpression[ '@ValueSource' ],
                        dst: valueID
                    } );
                }
            }
        }

        if ( isParameter ) {
            property = self.core.createNode( {
                parent: parentNode,
                base: self.meta.Property
            } );
            self.core.setAttribute( property, 'ValueType', 'Parametric' );
            self.logger.info( 'Created Parameter "' + propertyData[ '@Name' ] + '" with value : "' + value + '".' );
            if ( valueExpression.Default && valueExpression.Default.Value[ '#text' ] ) {
                self.core.setAttribute( property, 'Default', valueExpression.Default.Value[ '#text' ] );
            }
            if ( valueExpression.Maximum && valueExpression.Maximum.Value[ '#text' ] ) {
                self.core.setAttribute( property, 'Maximum', valueExpression.Maximum.Value[ '#text' ] );
            }
            if ( valueExpression.Minimum && valueExpression.Minimum.Value[ '#text' ] ) {
                self.core.setAttribute( property, 'Minimum', valueExpression.Minimum.Value[ '#text' ] );
            }
        } else {
            property = self.core.createNode( {
                parent: parentNode,
                base: self.meta.Property
            } );
            self.logger.info( 'Created Property "' + propertyData[ '@Name' ] + '" with value : "' + value + '".' );
        }

        self.core.setAttribute( property, 'name', propertyData[ '@Name' ] );
        self.core.setAttribute( property, 'DataType', propertyData.Value[ '@DataType' ] );
        self.core.setAttribute( property, 'Value', value );
        if ( propertyData.Value[ '@Unit' ] ) {
            self.core.setAttribute( property, 'Unit', propertyData.Value[ '@Unit' ] );
        }
        self.core.setRegistry( property, 'position', {
            x: parseInt( propertyData[ '@XPosition' ], 10 ),
            y: parseInt( propertyData[ '@YPosition' ], 10 )
        } );

        self.valueFlowTargetID2Node[ valueID ] = property;
    };

    AdmImporter.prototype.createFormula = function ( formulaData, parentNode ) {
        var self = this,
            i,
            id = formulaData[ '@ID' ],
            formula,
            isSimple = formulaData.hasOwnProperty( '@Operation' ),
            operands;

        if ( isSimple ) {
            formula = self.core.createNode( {
                parent: parentNode,
                base: self.meta.SimpleFormula
            } );
            self.core.setAttribute( formula, 'Method', formulaData[ '@Operation' ] );
            if ( formulaData[ '@Operand' ] ) {
                operands = formulaData[ '@Operand' ].split( " " );
                for ( i = 0; i < operands.length; i += 1 ) {
                    self.valueFlows.push( {
                        src: operands[ i ],
                        dst: id
                    } );
                }
            }
            self.logger.info( 'Created SimpleFormula "' + formulaData[ '@Name' ] + '".' );
        } else {
            formula = self.core.createNode( {
                parent: parentNode,
                base: self.meta.CustomFormula
            } );
            self.core.setAttribute( formula, 'Expression', formulaData[ '@Expression' ] );
            if ( formulaData.Operand ) {
                operands = formulaData.Operand;
                for ( i = 0; i < operands.length; i += 1 ) {
                    self.valueFlows.push( {
                        src: operands[ i ][ '@ValueSource' ],
                        dst: id,
                        symbol: operands[ i ][ '@Symbol' ]
                    } );
                }
            }
            self.logger.info( 'Created CustomFormula "' + formulaData[ '@Name' ] + '".' );
        }
        self.core.setAttribute( formula, 'name', formulaData[ '@Name' ] );

        self.core.setRegistry( formula, 'position', {
            x: parseInt( formulaData[ '@XPosition' ], 10 ),
            y: parseInt( formulaData[ '@YPosition' ], 10 )
        } );

        self.valueFlowTargetID2Node[ id ] = formula;
    };

    AdmImporter.prototype.addConnectionData = function ( parentNode, connectorData ) {
        var self = this,
            connectedConnectorIDs,
            i;
        if ( connectorData[ '@ConnectorComposition' ] ) {
            connectedConnectorIDs = connectorData[ '@ConnectorComposition' ].split( " " );
            for ( i = 0; i < connectedConnectorIDs.length; i += 1 ) {
                self.connectorCompositions.push( {
                    src: connectorData[ '@ID' ],
                    dst: connectedConnectorIDs[ i ]
                } );
            }
        }
    };

    AdmImporter.prototype.addPortMapData = function ( parentNode, portData ) {
        var self = this,
            connectedPortIDs,
            i;
        if ( portData[ '@PortMap' ] ) {
            connectedPortIDs = portData[ '@PortMap' ].split( " " );
            for ( i = 0; i < connectedPortIDs.length; i += 1 ) {
                self.portMaps.push( {
                    src: portData[ '@ID' ],
                    dst: connectedPortIDs[ i ]
                } );
            }
        }
    };
    //</editor-fold>

    //<editor-fold desc="============================ Making of connections =========================">
    AdmImporter.prototype.gatherComponentInstanceContent = function ( callback ) {
        var self = this,
            i,
            error = '',
            counter = self.componentInstances.length,
            afterLoadChildren = function ( componentInstance ) {
                return function ( err, children ) {
                    counter -= 1;
                    if ( err ) {
                        error += err;
                    } else {
                        self.addToConnectorsAndPropertiesMaps( componentInstance, children );
                    }
                    if ( counter <= 0 ) {
                        callback( error );
                    }
                };
            };

        if ( counter === 0 ) {
            callback( null );
            return;
        }
        for ( i = 0; i < self.componentInstances.length; i += 1 ) {
            self.core.loadChildren( self.componentInstances[ i ].node, afterLoadChildren( self.componentInstances[
                i ] ) );
        }
    };

    AdmImporter.prototype.addToConnectorsAndPropertiesMaps = function ( componentInstance, children ) {
        //        self.componentInstances.push({
        //            node: component,
        //            connIdInModel2ID: connIdInModel2ID,
        //            propertyIdInModel2ID: propertyIdInModel2ID
        //        });
        var self = this,
            i,
            id,
            metaTypeName;

        for ( i = 0; i < children.length; i += 1 ) {
            metaTypeName = self.core.getAttribute( self.getMetaType( children[ i ] ), 'name' );
            if ( metaTypeName === 'Connector' ) {
                id = self.core.getAttribute( children[ i ], 'ID' );
                if ( componentInstance.connIdInModel2ID[ id ] ) {
                    self.connID2Node[ componentInstance.connIdInModel2ID[ id ] ] = children[ i ];
                } else {
                    self.logger.error( 'ConnectorID' + id + ' not in ' + self.core.getAttribute( componentInstance.node,
                        'name' ) );
                }
            } else if ( metaTypeName === 'Property' ) {
                id = self.core.getAttribute( children[ i ], 'ID' );
                if ( componentInstance.propertyIdInModel2ID[ id ] ) {
                    self.valueFlowTargetID2Node[ componentInstance.propertyIdInModel2ID[ id ] ] = children[ i ];
                } else {
                    self.logger.error( 'PropertyID' + id + ' not in ' + self.core.getAttribute( componentInstance.node,
                        'name' ) );
                }
            } else if ( metaTypeName === 'DomainPort' ) {
                id = self.core.getAttribute( children[ i ], 'ID' );
                if ( componentInstance.portIdInModel2ID[ id ] ) {
                    self.portID2Node[ componentInstance.portIdInModel2ID[ id ] ] = children[ i ];
                } else {
                    self.logger.error( 'PortID' + id + ' not in ' + self.core.getAttribute( componentInstance.node,
                        'name' ) );
                }
            }
        }
    };

    AdmImporter.prototype.makeConnectorCompositions = function () {
        var self = this,
            srcID,
            dstID,
            parentNode,
            srcNode,
            dstNode,
            i,
            connectionNode,
            jointID,
            filteredConnections = {};

        for ( i = 0; i < self.connectorCompositions.length; i += 1 ) {
            srcID = self.connectorCompositions[ i ].src;
            dstID = self.connectorCompositions[ i ].dst;
            jointID = srcID + '__' + dstID;
            if ( filteredConnections[ jointID ] ) {
                // self.logger.info('Connection between ' + jointID + ' already added.');
            } else {
                self.logger.info( 'Adding [src] ' + srcID + ' and [dst]' + dstID );
                jointID = dstID + '__' + srcID;
                filteredConnections[ jointID ] = true;
                srcNode = self.connID2Node[ srcID ];
                dstNode = self.connID2Node[ dstID ];
                parentNode = self.getConnectionParent( srcNode, dstNode, srcID, dstID );
                if ( parentNode ) {
                    connectionNode = self.core.createNode( {
                        parent: parentNode,
                        base: self.meta.ConnectorComposition
                    } );
                    self.core.setPointer( connectionNode, 'src', srcNode );
                    self.core.setPointer( connectionNode, 'dst', dstNode );
                } else {
                    self.logger.error( 'Could not make connector-composition between src: ' + srcID +
                        ' and dst: ' + dstID + '.' );
                }
            }
        }
    };

    AdmImporter.prototype.makePortMaps = function () {
        var self = this,
            srcID,
            dstID,
            parentNode,
            srcNode,
            dstNode,
            i,
            portMapNode,
            jointID,
            filteredPortMaps = {};

        for ( i = 0; i < self.portMaps.length; i += 1 ) {
            srcID = self.portMaps[ i ].src;
            dstID = self.portMaps[ i ].dst;
            jointID = srcID + '__' + dstID;
            if ( filteredPortMaps[ jointID ] ) {
                // self.logger.info('Connection between ' + jointID + ' already added.');
            } else {
                self.logger.info( 'Adding [src] ' + srcID + ' and [dst]' + dstID );
                jointID = dstID + '__' + srcID;
                filteredPortMaps[ jointID ] = true;
                srcNode = self.portID2Node[ srcID ];
                dstNode = self.portID2Node[ dstID ];
                parentNode = self.getConnectionParent( srcNode, dstNode, srcID, dstID );
                if ( parentNode ) {
                    portMapNode = self.core.createNode( {
                        parent: parentNode,
                        base: self.meta.PortMap
                    } );
                    self.core.setPointer( portMapNode, 'src', srcNode );
                    self.core.setPointer( portMapNode, 'dst', dstNode );
                } else {
                    self.logger.error( 'Could not make port-map between src: ' + srcID +
                        ' and dst: ' + dstID + '.' );
                }
            }
        }
    };

    AdmImporter.prototype.makeValueFlows = function () {
        var self = this,
            i,
            srcNode,
            dstNode,
            symbol,
            parentNode,
            valueFlowNode;
        for ( i = 0; i < self.valueFlows.length; i += 1 ) {
            srcNode = self.valueFlowTargetID2Node[ self.valueFlows[ i ].src ];
            dstNode = self.valueFlowTargetID2Node[ self.valueFlows[ i ].dst ];
            symbol = self.valueFlows[ i ].symbol;
            parentNode = self.getConnectionParent( srcNode, dstNode, self.valueFlows[ i ].src, self.valueFlows[ i ]
                .dst );
            if ( parentNode ) {
                valueFlowNode = self.core.createNode( {
                    parent: parentNode,
                    base: self.meta.ValueFlowComposition
                } );
                self.core.setPointer( valueFlowNode, 'src', srcNode );
                self.core.setPointer( valueFlowNode, 'dst', dstNode );
                if ( symbol ) {
                    self.logger.info( 'About to add value-flow into customFormula' );
                    if ( symbol !== self.core.getAttribute( srcNode, 'name' ) ) {
                        self.core.setAttribute( valueFlowNode, 'VariableName', symbol );
                    }
                }
            } else {
                self.logger.error( 'Could not make value-flow connection between src: ' + self.valueFlows[ i ].src +
                    ' and dst: ' + self.valueFlows[ i ].dst + '.' );
            }
        }
    };

    AdmImporter.prototype.getConnectionParent = function ( srcNode, dstNode, srcId, dstId ) {
        var self = this,
            parent,
            errMsg,
            srcParent,
            dstParent,
            srcDepth,
            dstDepth;
        if ( !srcNode || !dstNode ) {
            errMsg = 'Making connection not possible srcID: "' + srcId + '", dstID: "' + dstId + '".';
            if ( srcNode ) {
                errMsg += ' SrcNode exists, name: "' + self.core.getAttribute( srcNode, 'name' ) + '", parent : "' +
                    self.core.getAttribute( self.core.getParent( srcNode ), 'name' ) + '".';
            } else {
                errMsg += ' The srcNode does not exist!';
            }
            if ( dstNode ) {
                errMsg += ' DstNode exists, name: "' + self.core.getAttribute( dstNode, 'name' ) + '", parent : "' +
                    self.core.getAttribute( self.core.getParent( dstNode ), 'name' ) + '".';
            } else {
                errMsg += ' The dstNode does not exist!';
            }
            self.currentSuccess = false;
            self.createMessage( dstNode || srcNode || null, errMsg, 'error' );
            return null;
        }
        srcParent = self.core.getParent( srcNode );
        dstParent = self.core.getParent( dstNode );
        if ( srcParent === dstParent && self.isMetaTypeOf( srcParent, self.META.Connector ) ) {
            parent = self.core.getParent( srcParent );
        } else if ( srcParent === dstParent ) {
            parent = srcParent;
        } else {
            srcDepth = self.core.getPath( srcParent )
                .split( '/' )
                .length;
            dstDepth = self.core.getPath( dstParent )
                .split( '/' )
                .length;
            if ( srcDepth < dstDepth ) {
                parent = srcParent;
            } else if ( dstDepth > srcDepth ) {
                parent = dstParent;
            } else {
                parent = self.core.getParent( srcParent );
            }
        }
        return parent;
    };

    //</editor-fold>

    AdmImporter.prototype.endsWith = function ( str, ending ) {
        var lastIndex = str.lastIndexOf( ending );
        return ( lastIndex !== -1 ) && ( lastIndex + ending.length === str.length );
    };

    AdmImporter.prototype.startsWith = function ( str, start ) {
        if ( start === '' ) {
            return true;
        }
        return start.length > 0 && str.substring( 0, start.length ) === start;
    };

    return AdmImporter;
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/AtmImporter/AtmImporter/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/**
 * Generated by PluginGenerator from webgme on Wed Jun 11 2014 13:31:41 GMT-0500 (Central Daylight Time).
 */

define( 'plugin/AtmImporter/AtmImporter/AtmImporter',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/AtmImporter/AtmImporter/meta',
    'plugin/AdmImporter/AdmImporter/AdmImporter',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, MetaTypes, AdmImporter, Converter ) {
    

    /**
     * Initializes a new instance of AtmImporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin AtmImporter.
     * @constructor
     */
    var AtmImporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = MetaTypes;
        this.atmData = null;
        this.testBench = null;
        this.admImporter = null;
        // ValueFlows
        this.valueFlowTargetID2Node = {};
        this.valueFlows = [];
        // Connectors
        this.connectorCompositions = [];
        this.connID2Node = {};
    };

    // Prototypal inheritance from PluginBase.
    AtmImporter.prototype = Object.create( PluginBase.prototype );
    AtmImporter.prototype.constructor = AtmImporter;

    /**
     * Gets the name of the AtmImporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    AtmImporter.prototype.getName = function () {
        return "ATM Importer";
    };

    /**
     * Gets the semantic version (semver.org) of the AtmImporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    AtmImporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the AtmImporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    AtmImporter.prototype.getDescription = function () {
        return "Import atm files generated from e.g. desktop GME.";
    };

    /**
     * Gets the configuration structure for the AtmImporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    AtmImporter.prototype.getConfigStructure = function () {
        return [ {
            'name': 'atmFile',
            'displayName': 'ATM file',
            'description': 'AVM TestBench Model.',
            'value': "",
            'valueType': 'asset',
            'readOnly': false
        } ];
    };


    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    AtmImporter.prototype.main = function ( callback ) {
        var self = this,
            config = self.getCurrentConfig(),
            arrayElementsInXml = {
                TestBench: false,
                TopLevelSystemUnderTest: false,
                TestComponent: true,
                Parameter: true,
                Metric: true,
                Settings: true,
                TestInjectionPoint: true,
                TestStructure: true,
                Workflow: false,
                Task: true,
                PropertyInstance: true,
                PrimitivePropertyInstance: true,
                ConnectorInstance: true,
                PortInstance: true
            },
            timeStart = new Date()
                .getTime(),

            finnishPlugin = function ( err ) {
                if ( err ) {
                    callback( err, self.result );
                    return;
                }

                self.save( 'Imported TestBench from ATM.', function ( err ) {
                    if ( err ) {
                        callback( err, self.result );
                        return;
                    }

                    //self.createMessage(null, 'ExecTime [s] total :: ' + ((new Date().getTime() - timeStart) / 1000).toString());
                    self.result.setSuccess( true );
                    callback( null, self.result );
                } );
            };

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }

        if ( self.isMetaTypeOf( self.activeNode, self.META.ATMFolder ) === false ) {
            self.createMessage( null, 'This plugin must be called from an ATMFolder.', 'error' );
            callback( null, self.result );
            return;
        }
        if ( !config.atmFile ) {
            self.createMessage( null, 'No adm file provided', 'error' );
            callback( null, self.result );
            return;
        }
        self.updateMETA( self.meta );

        self.blobClient.getObject( config.atmFile, function ( err, xmlArrayBuffer ) {
            var xmlToJson = new Converter.Xml2json( {
                skipWSText: true,
                arrayElements: arrayElementsInXml
            } );
            if ( err ) {
                self.logger.error( 'Retrieving atmFile failed with err:' + err.toString() );
                self.createMessage( null, 'Could not retrieve content of atm-file.', 'error' );
                callback( 'Retrieving atmFile failed with err:' + err.toString(), self.result );
                return;
            }
            self.atmData = xmlToJson.convertFromBuffer( xmlArrayBuffer );
            if ( self.atmData instanceof Error ) {
                self.createMessage( null, 'Given atm not valid xml: ' + self.atmData.message, 'error' );
                callback( null, self.result );
                return;
            }

            self.logger.debug( JSON.stringify( self.atmData, null, 4 ) );
            self.instantiateAdmImporter();
            self.createTestBench( self.activeNode );
            finnishPlugin( null );
        } );
    };

    AtmImporter.prototype.createTestBench = function ( atmFolderNode ) {
        var self = this,
            i, key,
            testBenchData = self.atmData.TestBench,
            testBench = self.core.createNode( {
                parent: atmFolderNode,
                base: self.meta.AVMTestBenchModel
            } ),
            testComponentsData,
            parametersData,
            metricsData;

        self.core.setAttribute( testBench, 'name', testBenchData[ '@Name' ] );

        if ( testBenchData.TopLevelSystemUnderTest ) {
            self.createTLSUT( testBench, testBenchData.TopLevelSystemUnderTest );
        } else {
            self.logger.error( 'There was no TopLevelSystemUnderTest defined!' );
            self.createMessage( testBench, 'There was no TopLevelSystemUnderTest defined!', 'error' );
        }

        if ( testBenchData.Workflow && testBenchData.Workflow[ '@Name' ] ) {
            self.createWorkflow( testBench, testBenchData.Workflow );
        } else {
            self.logger.warning( 'There was no workflow defined!' );
            self.createMessage( testBench, 'There was no Workflow defined!', 'warning' );
        }

        if ( testBenchData.TestComponent ) {
            testComponentsData = testBenchData.TestComponent;
            for ( i = 0; i < testComponentsData.length; i += 1 ) {
                self.admImporter.createComponent( testComponentsData[ i ], testBench );
            }
        }

        if ( testBenchData.Parameter ) {
            parametersData = testBenchData.Parameter;
            for ( i = 0; i < parametersData.length; i += 1 ) {
                self.admImporter.createProperty( parametersData[ i ], testBench );
            }
        }

        if ( testBenchData.Metric ) {
            metricsData = testBenchData.Metric;
            for ( i = 0; i < metricsData.length; i += 1 ) {
                self.createMetric( testBench, metricsData[ i ] );
            }
        }

        // Copy over connection data from admImporter.
        self.valueFlows = self.valueFlows.concat( self.admImporter.valueFlows );
        for ( key in self.admImporter.valueFlowTargetID2Node ) {
            if ( self.admImporter.valueFlowTargetID2Node.hasOwnProperty( key ) ) {
                self.valueFlowTargetID2Node[ key ] = self.admImporter.valueFlowTargetID2Node[ key ];
            }
        }

        self.connectorCompositions = self.connectorCompositions.concat( self.admImporter.connectorCompositions );
        for ( key in self.admImporter.connID2Node ) {
            if ( self.admImporter.connID2Node.hasOwnProperty( key ) ) {
                self.connID2Node[ key ] = self.admImporter.connID2Node[ key ];
            }
        }

        self.makeValueFlows( testBench );
        self.makeConnectorCompositions( testBench );
    };

    AtmImporter.prototype.createTLSUT = function ( testBenchNode, tlsutData ) {
        var self = this,
            i,
            propertiesData,
            propertyId,
            propertyIdInModel,
            property,
            connectorsData,
            connector,
            connectorID,
            tlsut = self.core.createNode( {
                parent: testBenchNode,
                base: self.meta.Container
            } );

        self.core.setAttribute( tlsut, 'name', 'SHOULDHAVENAME' );
        self.core.setRegistry( tlsut, 'position', {
            x: parseInt( tlsutData[ '@XPosition' ], 10 ),
            y: parseInt( tlsutData[ '@YPosition' ], 10 )
        } );

        if ( tlsutData.PropertyInstance ) {
            propertiesData = tlsutData.PropertyInstance;
            for ( i = 0; i < propertiesData.length; i += 1 ) {
                propertyId = propertiesData[ i ].Value[ '@ID' ];
                propertyIdInModel = propertiesData[ i ][ '@IDinSourceModel' ];
                if ( propertiesData[ i ].Value.ValueExpression ) {
                    self.valueFlows.push( {
                        src: propertiesData[ i ].Value.ValueExpression[ '@ValueSource' ],
                        dst: propertyId
                    } );
                    // Create a dummy-property...
                    property = self.core.createNode( {
                        parent: tlsut,
                        base: self.meta.Property
                    } );
                    self.core.setRegistry( property, 'position', {
                        x: 100,
                        y: ( 1 + i ) * 70
                    } );
                    self.core.setAttribute( property, 'name', 'Prop' + i.toString() );
                    self.core.setAttribute( property, 'ID', propertyIdInModel );
                    self.valueFlowTargetID2Node[ propertyId ] = property;
                }
            }
        }

        //TODO: This is a work-around for the missing connectorInstances in the ATM format!
        //TODO: This does not look for Connector-composition either..
        if ( tlsutData.PortInstance ) {
            connectorsData = tlsutData.PortInstance;
            for ( i = 0; i < connectorsData.length; i += 1 ) {
                connectorID = connectorsData[ i ][ '@ID' ];
                // Create a dummy-connector in the dummy-component.
                connector = self.core.createNode( {
                    parent: tlsut,
                    base: self.meta.Connector
                } );
                self.core.setRegistry( connector, 'position', {
                    x: 600,
                    y: ( 1 + i ) * 70
                } );
                self.core.setAttribute( connector, 'name', connectorsData[ i ][ '@NameInSourceModel' ] );
                self.core.setAttribute( connector, 'ID', connectorID );
                self.connID2Node[ connectorID ] = connector;
            }
        }
    };

    AtmImporter.prototype.createWorkflow = function ( testBenchNode, workflowData ) {
        var self = this,
            i,
            workflow = self.core.createNode( {
                parent: testBenchNode,
                base: self.meta.Workflow
            } ),
            tasksData,
            task;
        self.core.setAttribute( workflow, 'name', workflowData[ '@Name' ] );
        self.core.setRegistry( workflow, 'position', {
            x: 50,
            y: 80
        } );

        if ( workflowData.Task ) {
            tasksData = workflowData.Task;
            for ( i = 0; i < tasksData.length; i += 1 ) {
                task = self.core.createNode( {
                    parent: workflow,
                    base: self.meta.Task
                } );
                self.core.setAttribute( task, 'name', tasksData[ i ][ '@Name' ] );
                if ( self.admImporter.endsWith( tasksData[ i ][ '@xsi:type' ], 'InterpreterTask' ) ) {
                    self.core.setAttribute( task, 'COMName', tasksData[ i ][ '@COMName' ] );
                    self.core.setAttribute( task, 'Type', 'InterpreterTask' );
                } else if ( self.admImporter.endsWith( tasksData[ i ][ '@xsi:type' ], 'ExecutionTask' ) ) {
                    //self.core.setAttribute(task, 'Invocation', tasksData[i]['@Invocation']);
                    self.core.setAttribute( task, 'Type', 'ExecutionTask' );
                }
                self.core.setRegistry( task, 'position', {
                    x: 50,
                    y: 80 + i * 100
                } );
            }
        } else {
            self.logger.warning( 'No Tasks in work-flow!' );
            self.createMessage( workflow, 'There were no tasks defined in the workflow.', 'warning' );
        }
    };

    AtmImporter.prototype.createMetric = function ( testBenchNode, metricData ) {
        var self = this,
            metric = self.core.createNode( {
                parent: testBenchNode,
                base: self.meta.Metric
            } );
        self.core.setAttribute( metric, 'name', metricData[ '@Name' ] );
        self.core.setRegistry( metric, 'position', {
            x: parseInt( metricData[ '@XPosition' ], 10 ),
            y: parseInt( metricData[ '@YPosition' ], 10 )
        } );
    };

    AtmImporter.prototype.makeValueFlows = function ( testBenchNode ) {
        var self = this,
            i,
            srcNode,
            dstNode,
            symbol,
            valueFlowNode;
        for ( i = 0; i < self.valueFlows.length; i += 1 ) {
            srcNode = self.valueFlowTargetID2Node[ self.valueFlows[ i ].src ];
            dstNode = self.valueFlowTargetID2Node[ self.valueFlows[ i ].dst ];
            symbol = self.valueFlows[ i ].symbol;
            valueFlowNode = self.core.createNode( {
                parent: testBenchNode,
                base: self.meta.ValueFlowComposition
            } );
            self.core.setPointer( valueFlowNode, 'src', srcNode );
            self.core.setPointer( valueFlowNode, 'dst', dstNode );
            if ( symbol ) {
                self.logger.info( 'About to add value-flow into customFormula' );
                if ( symbol !== self.core.getAttribute( srcNode, 'name' ) ) {
                    self.core.setAttribute( valueFlowNode, 'VariableName', symbol );
                }
            }
        }
    };

    AtmImporter.prototype.makeConnectorCompositions = function ( testBenchNode ) {
        var self = this,
            srcID,
            dstID,
            srcNode,
            dstNode,
            i,
            connectionNode,
            jointID,
            filteredConnections = {};

        for ( i = 0; i < self.connectorCompositions.length; i += 1 ) {
            srcID = self.connectorCompositions[ i ].src;
            dstID = self.connectorCompositions[ i ].dst;
            jointID = srcID + '__' + dstID;
            if ( filteredConnections[ jointID ] ) {
                self.logger.info( 'Connection between ' + jointID + ' already added.' );
            } else {
                self.logger.info( 'Adding [src] ' + srcID + ' and [dst]' + dstID );
                jointID = dstID + '__' + srcID;
                filteredConnections[ jointID ] = true;
                srcNode = self.connID2Node[ srcID ];
                dstNode = self.connID2Node[ dstID ];
                connectionNode = self.core.createNode( {
                    parent: testBenchNode,
                    base: self.meta.ConnectorComposition
                } );
                self.core.setPointer( connectionNode, 'src', srcNode );
                self.core.setPointer( connectionNode, 'dst', dstNode );
            }
        }
    };

    AtmImporter.prototype.instantiateAdmImporter = function () {
        var self = this;
        self.admImporter = new AdmImporter();
        self.admImporter.meta = self.meta;
        self.admImporter.META = self.META;
        self.admImporter.core = self.core;
        self.admImporter.logger = self.logger;
        self.admImporter.result = self.result;
    };

    return AtmImporter;
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/AdmExporter/AdmExporter/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/* global define,require */
/* Generated file based on ejs templates */
define( 'plugin/AdmExporter/AdmExporter/Templates/Templates',[], function () {
    return {
        "execute.py.ejs": "import os\nimport sys\nimport shutil\nimport zipfile\nimport logging\nimport subprocess\nimport win32com.client\n\n## Setup a logger\n# Create logger with 'spam_application'.\nlogger = logging.getLogger()\nlogger.setLevel(logging.DEBUG)\n\n# Create file handler which logs even debug messages.\nif not os.path.isdir('log'):\n    os.mkdir('log')\n\nfh = logging.FileHandler(os.path.join('log', 'execute.log'))\nfh.setLevel(logging.DEBUG)\n\n# Create console handler with a higher log level.\nch = logging.StreamHandler()\nch.setLevel(logging.INFO)\n\n# Create formatter and add it to the handlers.\nformatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')\nfh.setFormatter(formatter)\nch.setFormatter(formatter)\n\n# Add the handlers to the logger.\nlogger.addHandler(fh)\nlogger.addHandler(ch)\n\n\n## Obtain the root directory for the META-tools.\n# Get the running meta-python path.\nsys_pieces = sys.executable.split(os.path.sep)\n# Drop the 'bin/Python27/Scripts/python.exe' part.\nsys_pieces = sys_pieces[:-4]\n# Make sure to get the slashes after e.g. \"C:\".\nif sys_pieces[0].endswith(':'):\n    sys_pieces[0] = sys_pieces[0] + os.path.sep\n# Join the pieces.\nMETA_DIR = os.path.join(*sys_pieces)\n\n# Disable early binding: full of race conditions writing the cache files,\n# and changes the semantics since inheritance isn't handled correctly\nimport win32com.client.gencache\n_savedGetClassForCLSID = win32com.client.gencache.GetClassForCLSID\nwin32com.client.gencache.GetClassForCLSID = lambda x: None\n\n\ndef parse_xme_and_save_to_mga(file_name='empty.xme'):\n    \"\"\"\n    Imports the xme project and saves it to a mga-file with the same name.\n    (Will overwrite any existing mga with same path.)\n\n    returns : mga_path : path to newly created mga\n    \"\"\"\n    mga_file = file_name[:-3] + 'mga'\n    mga_path = os.path.abspath(mga_file)\n    logger.debug(\"About to parse .xme, mga will be saved to \" + mga_path)\n    parser = win32com.client.Dispatch('Mga.MgaParser')\n    (paradigm, paradigm_v, paradigm_guid, basename, version) = parser.GetXMLInfo(file_name)\n    logger.debug('Xme info :')\n    logger.debug('  paradigm     : {0}'.format(paradigm))\n    logger.debug('  paradigm_v   : {0}'.format(paradigm_v))\n    logger.debug('  paradigm_guid: {0}'.format(paradigm_guid))\n    logger.debug('  basename     : {0}'.format(basename))\n    logger.debug('  version      : {0}'.format(version))\n    if paradigm != 'CyPhyML':\n        raise IOError(\"Given xme file must be using CyPhyML as paradigm, not {0}\".format(paradigm))\n\n    project = win32com.client.Dispatch('Mga.MgaProject')\n    project.Create('MGA={0}'.format(mga_path), paradigm)\n    try:\n        parser.ParseProject(project, file_name)\n        project.Save()\n        logging.debug(\"Mga saved to \" + mga_file)\n    finally:\n        project.Close(True)\n\n    return mga_path\n\n\ndef extract_components(src_path='ACMs', dst_path='components_extracted'):\n    if os.path.isdir(dst_path):\n        logging.debug('Found dir :{0} - removing and making new...'.format(dst_path))\n        shutil.rmtree(dst_path)\n        os.mkdir(dst_path)\n    files = os.listdir(src_path)\n    logging.debug('Components found in directory : {0}'.format(files))\n    for f_name in files:\n        if f_name.endswith('.zip'):\n            zippy = zipfile.ZipFile(os.path.join(src_path, f_name))\n            zippy.extractall(os.path.join(dst_path, f_name.rstrip('.zip')))\n\n\ndef import_components(mga_path='empty.mga', dir_path='components_extracted'):\n    exec_name = 'CyPhyComponentImporterCL.exe'\n    exec_path = os.path.join(META_DIR, 'bin', 'CyPhyComponentImporterCL.exe')\n    if not os.path.isfile(exec_path):\n        logging.debug('Did not find {0} in bin directory.'.format(exec_name))\n        logging.debug('Assuming developer machine, looking in src directory...'.format(exec_name))\n        exec_path = os.path.join(META_DIR, 'src', 'CyPhyComponentImporterCL', 'bin', 'Release', exec_name)\n        if not os.path.isfile(exec_path):\n            raise IOError('Did not find {0}'.format(exec_path))\n\n    command = '{0} -r \"{1}\" \"{2}\"'.format(exec_path, dir_path, mga_path)\n    logger.debug('About to import components using command:')\n    logger.debug(command)\n    subprocess.call(command)\n\n\ndef import_design(adm_file, mga_path='empty.mga'):\n    project_conn_str = 'MGA={0}'.format(mga_path)\n    project = win32com.client.Dispatch('Mga.MgaProject')\n    project.Open(project_conn_str)\n    is_in_transaction = False\n    try:\n        interpreter = win32com.client.Dispatch('MGA.Interpreter.CyPhyDesignImporter')\n        interpreter.Initialize(project)\n        logger.debug('About to begin transaction..')\n        project.BeginTransactionInNewTerr()\n        logger.info('Transaction began.')\n        is_in_transaction = True\n        logger.debug('Invoking CyPhyDesignImporter.ImportDesign..')\n        design_mga = interpreter.ImportDesign(project, adm_file)\n        logger.info('Import design finished, returned:')\n        logger.info('   Name : {0}'.format(design_mga.Name))\n        logger.info('   Path : {0}'.format(design_mga.AbsPath))\n        logger.info('   GUID : {0}'.format(design_mga.GetGuidDisp()))\n        logger.debug('About to commit transaction..')\n        project.CommitTransaction()\n        logger.info('Transaction committed.')\n        is_in_transaction = False\n    finally:\n        if is_in_transaction:\n            logger.debug('About to abort transaction..')\n            project.AbortTransaction()\n            logger.info('Transaction aborted.')\n            project.Close(True)\n        else:\n            logger.debug('About to save project..')\n            project.Close(False)\n            logger.debug('Project saved.')\n\nif __name__ == '__main__':\n    try:\n        adm_path = [f for f in os.listdir('.') if f.endswith('.adm')][0]\n    except IndexError:\n        logger.error('Could not find an adm file at {0}'.format(os.getcwd()))\n        sys.exit(1)\n    extract_components()\n    logger.info('Components extracted...')\n    mga_file = parse_xme_and_save_to_mga()\n    logger.info('Mga created...')\n    import_components()\n    logger.info('Components imported...')\n    import_design(adm_path)\n    logger.info('Design imported...')",
        "run_execution.cmd.ejs": ":: Executes the package\necho off\npushd %~dp0\n%SystemRoot%\\SysWoW64\\REG.exe query \"HKLM\\software\\META\" /v \"META_PATH\"\n\nSET QUERY_ERRORLEVEL=%ERRORLEVEL%\n\nIF %QUERY_ERRORLEVEL% == 0 (\n        FOR /F \"skip=2 tokens=2,*\" %%A IN ('%SystemRoot%\\SysWoW64\\REG.exe query \"HKLM\\software\\META\" /v \"META_PATH\"') DO SET META_PATH=%%B)\nSET META_PYTHON_EXE=\"%META_PATH%\\bin\\Python27\\Scripts\\Python.exe\"\n    %META_PYTHON_EXE% execute.py\n)\nIF %QUERY_ERRORLEVEL% == 1 (\n    echo on\necho \"META tools not installed.\" >> _FAILED.txt\necho \"See Error Log: _FAILED.txt\"\nexit /b %QUERY_ERRORLEVEL%\n)\npopd"
    };
} );
define('ejs',[], function() {
    var ejs=function(){function require(p){if("fs"==p)return{};if("path"==p)return{};var path=require.resolve(p),mod=require.modules[path];if(!mod)throw new Error('failed to require "'+p+'"');if(!mod.exports){mod.exports={};mod.call(mod.exports,mod,mod.exports,require.relative(path))}return mod.exports}require.modules={};require.resolve=function(path){var orig=path,reg=path+".js",index=path+"/index.js";return require.modules[reg]&&reg||require.modules[index]&&index||orig};require.register=function(path,fn){require.modules[path]=fn};require.relative=function(parent){return function(p){if("."!=p.substr(0,1))return require(p);var path=parent.split("/"),segs=p.split("/");path.pop();for(var i=0;i<segs.length;i++){var seg=segs[i];if(".."==seg)path.pop();else if("."!=seg)path.push(seg)}return require(path.join("/"))}};require.register("ejs.js",function(module,exports,require){var utils=require("./utils"),path=require("path"),dirname=path.dirname,extname=path.extname,join=path.join,fs=require("fs"),read=fs.readFileSync;var filters=exports.filters=require("./filters");var cache={};exports.clearCache=function(){cache={}};function filtered(js){return js.substr(1).split("|").reduce(function(js,filter){var parts=filter.split(":"),name=parts.shift(),args=parts.join(":")||"";if(args)args=", "+args;return"filters."+name+"("+js+args+")"})}function rethrow(err,str,filename,lineno){var lines=str.split("\n"),start=Math.max(lineno-3,0),end=Math.min(lines.length,lineno+3);var context=lines.slice(start,end).map(function(line,i){var curr=i+start+1;return(curr==lineno?" >> ":"    ")+curr+"| "+line}).join("\n");err.path=filename;err.message=(filename||"ejs")+":"+lineno+"\n"+context+"\n\n"+err.message;throw err}var parse=exports.parse=function(str,options){var options=options||{},open=options.open||exports.open||"<%",close=options.close||exports.close||"%>",filename=options.filename,compileDebug=options.compileDebug!==false,buf="";buf+="var buf = [];";if(false!==options._with)buf+="\nwith (locals || {}) { (function(){ ";buf+="\n buf.push('";var lineno=1;var consumeEOL=false;for(var i=0,len=str.length;i<len;++i){var stri=str[i];if(str.slice(i,open.length+i)==open){i+=open.length;var prefix,postfix,line=(compileDebug?"__stack.lineno=":"")+lineno;switch(str[i]){case"=":prefix="', escape(("+line+", ";postfix=")), '";++i;break;case"-":prefix="', ("+line+", ";postfix="), '";++i;break;default:prefix="');"+line+";";postfix="; buf.push('"}var end=str.indexOf(close,i);if(end<0){throw new Error('Could not find matching close tag "'+close+'".')}var js=str.substring(i,end),start=i,include=null,n=0;if("-"==js[js.length-1]){js=js.substring(0,js.length-2);consumeEOL=true}if(0==js.trim().indexOf("include")){var name=js.trim().slice(7).trim();if(!filename)throw new Error("filename option is required for includes");var path=resolveInclude(name,filename);include=read(path,"utf8");include=exports.parse(include,{filename:path,_with:false,open:open,close:close,compileDebug:compileDebug});buf+="' + (function(){"+include+"})() + '";js=""}while(~(n=js.indexOf("\n",n)))n++,lineno++;if(js.substr(0,1)==":")js=filtered(js);if(js){if(js.lastIndexOf("//")>js.lastIndexOf("\n"))js+="\n";buf+=prefix;buf+=js;buf+=postfix}i+=end-start+close.length-1}else if(stri=="\\"){buf+="\\\\"}else if(stri=="'"){buf+="\\'"}else if(stri=="\r"){}else if(stri=="\n"){if(consumeEOL){consumeEOL=false}else{buf+="\\n";lineno++}}else{buf+=stri}}if(false!==options._with)buf+="'); })();\n} \nreturn buf.join('');";else buf+="');\nreturn buf.join('');";return buf};var compile=exports.compile=function(str,options){options=options||{};var escape=options.escape||utils.escape;var input=JSON.stringify(str),compileDebug=options.compileDebug!==false,client=options.client,filename=options.filename?JSON.stringify(options.filename):"undefined";if(compileDebug){str=["var __stack = { lineno: 1, input: "+input+", filename: "+filename+" };",rethrow.toString(),"try {",exports.parse(str,options),"} catch (err) {","  rethrow(err, __stack.input, __stack.filename, __stack.lineno);","}"].join("\n")}else{str=exports.parse(str,options)}if(options.debug)console.log(str);if(client)str="escape = escape || "+escape.toString()+";\n"+str;try{var fn=new Function("locals, filters, escape, rethrow",str)}catch(err){if("SyntaxError"==err.name){err.message+=options.filename?" in "+filename:" while compiling ejs"}throw err}if(client)return fn;return function(locals){return fn.call(this,locals,filters,escape,rethrow)}};exports.render=function(str,options){var fn,options=options||{};if(options.cache){if(options.filename){fn=cache[options.filename]||(cache[options.filename]=compile(str,options))}else{throw new Error('"cache" option requires "filename".')}}else{fn=compile(str,options)}options.__proto__=options.locals;return fn.call(options.scope,options)};exports.renderFile=function(path,options,fn){var key=path+":string";if("function"==typeof options){fn=options,options={}}options.filename=path;var str;try{str=options.cache?cache[key]||(cache[key]=read(path,"utf8")):read(path,"utf8")}catch(err){fn(err);return}fn(null,exports.render(str,options))};function resolveInclude(name,filename){var path=join(dirname(filename),name);var ext=extname(name);if(!ext)path+=".ejs";return path}exports.__express=exports.renderFile;if(require.extensions){require.extensions[".ejs"]=function(module,filename){filename=filename||module.filename;var options={filename:filename,client:true},template=fs.readFileSync(filename).toString(),fn=compile(template,options);module._compile("module.exports = "+fn.toString()+";",filename)}}else if(require.registerExtension){require.registerExtension(".ejs",function(src){return compile(src,{})})}});require.register("filters.js",function(module,exports,require){exports.first=function(obj){return obj[0]};exports.last=function(obj){return obj[obj.length-1]};exports.capitalize=function(str){str=String(str);return str[0].toUpperCase()+str.substr(1,str.length)};exports.downcase=function(str){return String(str).toLowerCase()};exports.upcase=function(str){return String(str).toUpperCase()};exports.sort=function(obj){return Object.create(obj).sort()};exports.sort_by=function(obj,prop){return Object.create(obj).sort(function(a,b){a=a[prop],b=b[prop];if(a>b)return 1;if(a<b)return-1;return 0})};exports.size=exports.length=function(obj){return obj.length};exports.plus=function(a,b){return Number(a)+Number(b)};exports.minus=function(a,b){return Number(a)-Number(b)};exports.times=function(a,b){return Number(a)*Number(b)};exports.divided_by=function(a,b){return Number(a)/Number(b)};exports.join=function(obj,str){return obj.join(str||", ")};exports.truncate=function(str,len,append){str=String(str);if(str.length>len){str=str.slice(0,len);if(append)str+=append}return str};exports.truncate_words=function(str,n){var str=String(str),words=str.split(/ +/);return words.slice(0,n).join(" ")};exports.replace=function(str,pattern,substitution){return String(str).replace(pattern,substitution||"")};exports.prepend=function(obj,val){return Array.isArray(obj)?[val].concat(obj):val+obj};exports.append=function(obj,val){return Array.isArray(obj)?obj.concat(val):obj+val};exports.map=function(arr,prop){return arr.map(function(obj){return obj[prop]})};exports.reverse=function(obj){return Array.isArray(obj)?obj.reverse():String(obj).split("").reverse().join("")};exports.get=function(obj,prop){return obj[prop]};exports.json=function(obj){return JSON.stringify(obj)}});require.register("utils.js",function(module,exports,require){exports.escape=function(html){return String(html).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;").replace(/"/g,"&quot;")}});return require("ejs")}();
    return ejs;
});

/*globals define*/
/**
 * Generated by PluginGenerator from webgme on Tue Apr 29 2014 17:05:39 GMT-0500 (Central Daylight Time).
 */

define( 'plugin/AdmExporter/AdmExporter/AdmExporter',[
    'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/AdmExporter/AdmExporter/meta',
    'xmljsonconverter',
    'plugin/AdmExporter/AdmExporter/Templates/Templates',
    'ejs'
], function ( PluginConfig, PluginBase, MetaTypes, Converter, TEMPLATES, ejs ) {
    

    /**
     * Initializes a new instance of AdmExporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin AdmExporter.
     * @constructor
     */
    var AdmExporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = null;
        this.admData = {
            "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
            "@DesignID": '',
            "@Name": '',
            "@xmlns": "avm",
            "RootContainer": null
        };

        this.acmFiles = {};
        this.gatheredAcms = {};
        this.includeAcms = true;
        // No value flows or connector-compositions beyond the root-container
        // should be reported in the adm file.
        this.rootPath = null;
        this.selectedCfg = null;
        this.selectedAlternatives = null;
    };

    // Prototypal inheritance from PluginBase.
    AdmExporter.prototype = Object.create( PluginBase.prototype );
    AdmExporter.prototype.constructor = AdmExporter;

    /**
     * Gets the name of the AdmExporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    AdmExporter.prototype.getName = function () {
        return "ADM Exporter";
    };

    /**
     * Gets the semantic version (semver.org) of the AdmExporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    AdmExporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the AdmExporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    AdmExporter.prototype.getDescription = function () {
        return "Exports a design into an adm.";
    };

    /**
     * Gets the configuration structure for the AdmExporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    AdmExporter.prototype.getConfigStructure = function () {
        return [ {
            'name': 'acms',
            'displayName': 'Include ACMs',
            'description': 'Bundles all encountered ACMs within the package and creates scripts for importing the ' +
                'design into desktop GME.',
            'value': false,
            'valueType': 'boolean',
            'readOnly': false
        }, {
            'name': 'desertCfg',
            'displayName': 'Desert Configuration.',
            'description': 'Only this configuration will be exported. (If empty whole design space will be exported.)',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        } ];
    };


    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    AdmExporter.prototype.main = function ( callback ) {
        var self = this,
            //timeStart = new Date().getTime(),
            jsonToXml = new Converter.Json2xml(),
            config = self.getCurrentConfig(),
            finishAndSaveArtifact,
            createArtifacts;
        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }
        if ( self.isMetaTypeOf( self.activeNode, self.META.Container ) === false ) {
            self.createMessage( null, 'This plugin must be called from a Container.', 'error' );
            callback( null, self.result );
            return;
        }
        self.meta = MetaTypes;
        self.updateMETA( self.meta );
        self.rootPath = self.core.getPath( self.activeNode );
        finishAndSaveArtifact = function ( artifact ) {
            artifact.save( function ( err, hash ) {
                if ( err ) {
                    self.result.setSuccess( false );
                    callback( 'Could not save artifact : err' + err.toString(), self.result );
                    return;
                }
                self.result.addArtifact( hash );
                self.result.setSuccess( true );
                callback( null, self.result );
            } );
        };

        self.setupDesertCfg( config.desertCfg, function ( err ) {
            if ( err ) {
                self.logger.error( err );
                callback( null, self.result );
                return;
            }
            if ( self.selectedAlternatives ) {
                self.logger.info( 'Running on single configuration' );
                self.logger.info( JSON.stringify( self.selectedAlternatives, null ) );
            }
            createArtifacts = function ( err ) {
                var artifact,
                    admXmlStr;
                if ( err ) {
                    callback( err, self.result );
                    return;
                }
                artifact = self.blobClient.createArtifact( 'design' );
                admXmlStr = jsonToXml.convertToString( {
                    Design: self.admData
                } );

                artifact.addFile( self.admData[ '@Name' ] + '.adm', admXmlStr, function ( err, hash ) {
                    if ( err ) {
                        self.result.setSuccess( false );
                        callback( 'Could not add adm file : err' + err.toString(), self.result );
                        return;
                    }
                    self.logger.info( 'ADM hash: ' + hash );
                    if ( self.includeAcms ) {
                        artifact.addObjectHashes( self.acmFiles, function ( err, hashes ) {
                            if ( err ) {
                                self.result.setSuccess( false );
                                callback( 'Could not add acm files : err' + err.toString(), self.result );
                                return;
                            }
                            self.logger.info( 'ACM hashes: ' + hashes.toString() );
                            artifact.addFiles( {
                                'execute.py': ejs.render( TEMPLATES[ 'execute.py.ejs' ] ),
                                'run_execution.cmd': ejs.render( TEMPLATES[ 'run_execution.cmd.ejs' ] ),
                                'empty.xme': ejs.render( TEMPLATES[ 'empty.xme.ejs' ] ),
                                'executor_config.json': JSON.stringify( {
                                    cmd: 'run_execution.cmd',
                                    files: [],
                                    dirs: []
                                }, null, 4 )
                            }, function ( err, hashes ) {
                                if ( err ) {
                                    callback( 'Could not script files : err' + err.toString(), self
                                        .result );
                                    return;
                                }
                                self.logger.info( 'Script hashes: ' + hashes.toString() );
                                finishAndSaveArtifact( artifact );
                            } );
                        } );
                    } else {
                        finishAndSaveArtifact( artifact );
                    }
                } );
            };
            self.exploreDesign( self.activeNode, config.acms, createArtifacts );
        } );
    };

    AdmExporter.prototype.setupDesertCfg = function ( desertCfgId, callback ) {
        var self = this;
        if ( !desertCfgId ) {
            callback( null );
            return;
        }
        self.core.loadByPath( self.rootNode, desertCfgId, function ( err, cfgNode ) {
            var name,
                i,
                aas;
            if ( err ) {
                self.createMessage( null, 'Could not load given configuration node, err: ' + err.toString(),
                    'error' );
                callback( err );
                return;
            }
            if ( self.startsWith( desertCfgId, self.rootPath ) === false ) {
                self.createMessage( cfgNode, 'Given desert configuration is not within design.', 'error' );
                callback( 'Given desert configuration is not within design.' );
                return;
            }
            if ( self.isMetaTypeOf( cfgNode, self.meta.DesertConfiguration ) === false ) {
                self.createMessage( cfgNode,
                    'Given path to desert configuration is not pointing to a DesertConfiguration node.',
                    'error' );
                callback( 'Wrong meta-type of desert configuration.' );
                return;
            }
            name = self.core.getAttribute( cfgNode, 'name' );
            aas = JSON.parse( self.core.getAttribute( cfgNode, 'AlternativeAssignments' ) );
            self.selectedAlternatives = {};
            for ( i = 0; i < aas.length; i += 1 ) {
                self.selectedAlternatives[ aas[ i ].alternativeOf ] = aas[ i ].selectedAlternative;
            }
            callback( null );
        } );
    };

    AdmExporter.prototype.shouldBeGenerated = function ( node ) {
        var self = this,
            parentNode,
            parentId;
        if ( !self.selectedAlternatives ) {
            return true;
        }
        parentNode = self.core.getParent( node );
        if ( self.core.getAttribute( parentNode, 'Type' ) !== 'Alternative' ) {
            return true;
        }
        parentId = self.core.getPath( parentNode );
        if ( self.selectedAlternatives[ parentId ] ) {
            if ( self.selectedAlternatives[ parentId ] === self.core.getPath( node ) ) {
                return true;
            }
        } else {
            self.createMessage( parentNode,
                'Container is not in the desert-configuration, the latter is out of date.',
                'error' );
            return false;
        }

        return false;
    };

    AdmExporter.prototype.exploreDesign = function ( startNode, includeACMs, callback ) {
        var self = this,
            designName = self.core.getAttribute( startNode, 'name' );
        self.includeAcms = includeACMs;
        self.admData[ '@Name' ] = designName;
        self.admData[ '@DesignID' ] = self.core.getGuid( startNode );
        self.rootPath = self.core.getPath( startNode );
        self.logger.info( 'rootPath is ' + self.rootPath );
        self.visitAllChildrenFromRootContainer( startNode, callback );
    };

    AdmExporter.prototype.atModelNode = function ( node, parent, containerData, callback ) {
        var self = this,
            nodeType = self.core.getAttribute( self.getMetaType( node ), 'name' ),
            nodeName = self.core.getAttribute( node, 'name' ),
            parentName = self.core.getAttribute( parent, 'name' );

        if ( nodeType === 'AVMComponentModel' ) {
            if ( self.shouldBeGenerated( node ) ) {
                self.addComponentInstance( node, parent, containerData, callback );
            } else {
                self.logger.info( 'At node "' + nodeName + '" of type "' + nodeType + '" with parent "' +
                    parentName + '".' );
                self.logger.info( 'Will not be generated!' );
                callback( null );
            }
        } else if ( nodeType === 'Connector' ) {
            self.addConnector( node, parent, containerData, callback );
        } else if ( nodeType === 'Property' ) {
            self.addProperty( node, parent, containerData, callback );
        } else if ( nodeType === 'SimpleFormula' ) {
            self.addFormula( node, parent, containerData, true, callback );
        } else if ( nodeType === 'CustomFormula' ) {
            self.addFormula( node, parent, containerData, false, callback );
        } else if ( nodeType === 'DomainPort' ) {
            self.addDomainPort( node, parent, containerData, callback );
        } else if ( nodeType === 'AssemblyRoot' ) {
            self.addAssemblyRoot( node, parent, containerData, callback );
        } else {
            callback( null );
        }
    };

    AdmExporter.prototype.addComponentInstance = function ( node, parent, containerData, callback ) {
        var self = this,
            pos = self.core.getRegistry( node, 'position' ),
            nodeName = self.core.getAttribute( node, 'name' ),
            acmHash,
            componentID = self.core.getAttribute( node, 'ID' ),
            data = {
                "@Name": nodeName,
                "@ComponentID": componentID,
                "@ID": self.core.getGuid( node ),
                "@XPosition": Math.floor( pos.x ),
                "@YPosition": Math.floor( pos.y ),
                "PortInstance": [],
                "PrimitivePropertyInstance": [],
                "ConnectorInstance": []
            };

        if ( containerData.TopLevelSystemUnderTest === undefined ) {
            containerData.ComponentInstance.push( data );
        } else {
            containerData.TestComponent.push( data );
        }

        if ( self.includeAcms ) {
            acmHash = self.core.getAttribute( node, 'Resource' );
            if ( acmHash ) {
                if ( self.gatheredAcms[ acmHash ] ) {
                    self.logger.info( 'ACM of "' + nodeName + '" used twice. Not adding again..' );
                } else {
                    self.acmFiles[ 'ACMs/' + nodeName + '__' + componentID.replace( /[^\w]/gi, '_' ) + '.zip' ] =
                        acmHash;
                    self.gatheredAcms[ acmHash ] = true;
                }
            } else {
                self.logger.error( 'ACM was not specified for ' + nodeName );
                callback( 'ACM was not specified for ' + nodeName );
                return;
            }
        }
        self.core.loadChildren( node, function ( err, children ) {
            var i,
                error = '',
                counter,
                counterCallback;
            if ( err ) {
                callback( 'loadChildren failed for ' + nodeName + ' :' + err.toString() );
                return;
            }

            counterCallback = function ( err ) {
                error = err ? error + err : error;
                counter -= 1;
                if ( counter <= 0 ) {
                    callback( error );
                }
            };

            if ( children.length === 0 ) {
                counter = 1;
                counterCallback( null );
                return;
            }

            counter = children.length;

            for ( i = 0; i < children.length; i += 1 ) {
                if ( self.isMetaTypeOf( children[ i ], self.meta.Connector ) ) {
                    self.addConnector( children[ i ], node, data, counterCallback );
                } else if ( self.isMetaTypeOf( children[ i ], self.meta.DomainPort ) ) {
                    self.addDomainPort( children[ i ], node, data, counterCallback );
                } else if ( self.isMetaTypeOf( children[ i ], self.meta.Property ) ) {
                    self.addProperty( children[ i ], node, data, counterCallback );
                } else {
                    counterCallback( null );
                }
            }
        } );
    };

    //<editor-fold desc="=========================== Connectors/DomainPorts ==========================">
    AdmExporter.prototype.addConnector = function ( node, parent, containerData, callback ) {
        var self = this,
            parentType = self.core.getAttribute( self.getMetaType( parent ), 'name' ),
            data = self.getConnectorData( node, parent );

        if ( parentType === 'Container' ) {
            containerData.Connector.push( data );
        } else if ( parentType === 'AVMComponentModel' ) {
            containerData.ConnectorInstance.push( data );
        }

        self.addRoles( node, data, function ( err ) {
            if ( err ) {
                callback( err );
                return;
            }
            self.getConnectionString( node, function ( err, connectionString ) {
                if ( err ) {
                    callback( err );
                    return;
                }
                data[ '@ConnectorComposition' ] = connectionString;
                callback( null );
            } );
        } );
    };

    AdmExporter.prototype.addDomainPort = function ( node, parent, containerData, callback ) {
        var self = this,
            parentType = self.core.getAttribute( self.getMetaType( parent ), 'name' ),
            data = self.getDomainPortData( node, parent );

        if ( parentType === 'Container' ) {
            containerData.Port.push( data );
        } else if ( parentType === 'AVMComponentModel' ) {
            containerData.PortInstance.push( data );
        }

        self.getConnectionString( node, function ( err, connectionString ) {
            if ( err ) {
                callback( err );
                return;
            }
            data[ '@PortMap' ] = connectionString;
            callback( null );
        } );
    };

    AdmExporter.prototype.addRoles = function ( connectorNode, data, callback ) {
        var self = this,
            domainConnectors = data.Role,
            nodeName;

        if ( domainConnectors === undefined ) {
            // This a connector within an ACM..
            callback( null );
            return;
        }

        nodeName = self.core.getAttribute( connectorNode, 'name' );
        self.core.loadChildren( connectorNode, function ( err, children ) {
            var i,
                roleData,
                counter = children.length,
                error = '',
                getCounterCallback = function ( portData ) {
                    return function ( err, connectionString ) {
                        error = err ? error + err : error;
                        portData[ '@PortMap' ] = connectionString;
                        counter -= 1;
                        if ( counter === 0 ) {
                            callback( error );
                        }
                    };
                };
            if ( err ) {
                callback( 'loadChildren failed for connector ' + nodeName + ' :' + err.toString() );
                return;
            }

            if ( children.length === 0 ) {
                callback( null );
            }
            for ( i = 0; i < children.length; i += 1 ) {
                if ( self.isMetaTypeOf( children[ i ], self.META.DomainPort ) ) {
                    roleData = self.getDomainPortData( children[ i ], connectorNode );
                    domainConnectors.push( roleData );
                    self.getConnectionString( children[ i ], getCounterCallback( roleData ) );
                } else if ( self.isMetaTypeOf( children[ i ], self.META.PortMap ) ) {
                    // TODO
                    if ( --counter === 0 ) {
                        callback( error );
                    }
                } else {
                    self.logger.error( "Unexpected '" + self.getMetaType( children[ i ] ) + "' in Connector '" +
                        core.getAttribute( "name", connectorNode ) );
                    if ( --counter === 0 ) {
                        callback( error );
                    }
                }
            }
        } );
    };


    /**
     * Gets the full connection string for ConnectorComposition/PortMap of a Connector/DomainPort.
     * @param portNode - Connector or DomainPort.
     * @param {function} callback
     */
    AdmExporter.prototype.getConnectionString = function ( portNode, callback ) {
        var self = this,
            collectionNames = self.core.getCollectionNames( portNode ),
            counter = 2,
            error = '',
            connectionString = '',
            counterCallback = function ( err ) {
                error = err ? error + err : error;
                counter -= 1;
                if ( counter === 0 ) {
                    callback( error, connectionString );
                }
            };

        if ( collectionNames.indexOf( 'src' ) > -1 ) {
            self._getPartialConnectionString( portNode, 'src', function ( err, dstId ) {
                if ( err ) {
                    counterCallback( err );
                    return;
                }
                connectionString = self.appendWhiteSpacedString( connectionString, dstId );
                counterCallback( null );
            } );
        } else {
            counterCallback( null );
        }
        if ( collectionNames.indexOf( 'dst' ) > -1 ) {
            self._getPartialConnectionString( portNode, 'dst', function ( err, srcId ) {
                if ( err ) {
                    counterCallback( err );
                    return;
                }
                connectionString = self.appendWhiteSpacedString( connectionString, srcId );
                counterCallback( null );
            } );
        } else {
            counterCallback( null );
        }
    };

    AdmExporter.prototype._getPartialConnectionString = function ( portNode, collectionName, callback ) {
        var self = this,
            pointerName = collectionName === 'src' ? 'dst' : 'src';

        self.core.loadCollection( portNode, collectionName, function ( err, connections ) {
            var counter, i,
                counterCallback,
                error = '',
                connectedIDs = '';
            if ( err ) {
                callback( err );
                return;
            }
            counterCallback = function ( err, connectedID ) {
                if ( err ) {
                    error += err;
                } else {
                    connectedIDs = self.appendWhiteSpacedString( connectedIDs, connectedID );
                }
                counter -= 1;
                if ( counter <= 0 ) {
                    callback( error, connectedIDs );
                }
            };
            counter = connections.length;
            if ( connections.length === 0 ) {
                counterCallback( null, '' );
                return;
            }
            for ( i = 0; i < connections.length; i += 1 ) {
                self.getConnectedPortID( connections[ i ], pointerName, counterCallback );
            }
        } );
    };

    /**
     * Gets the ID of the connected Connector or DomainPort. (If the connected one is not part of the configuration -
     * the 'returned' id is empty.)
     * @param connectionNode - ConnectorComposition or PortMap to get the connected Connector/DomainPort through.
     * @param {string} pointerName - 'src' or 'dst'.
     * @param {function} callback
     */
    AdmExporter.prototype.getConnectedPortID = function ( connectionNode, pointerName, callback ) {
        var self = this,
            hasPointer = self.core.hasPointer( connectionNode, pointerName );

        if ( hasPointer ) {
            self.core.loadPointer( connectionNode, pointerName, function ( err, connectedPort ) {
                var id = '',
                    parent,
                    grandParent,
                    grandParentMetaType,
                    parentMetaType;
                if ( err ) {
                    callback( err );
                    return;
                }
                if ( self.nodeIsWithinDesign( connectedPort ) ) {
                    parent = self.core.getParent( connectedPort );
                    parentMetaType = self.core.getAttribute( self.getMetaType( parent ), 'name' );
                    if ( parentMetaType === 'AVMComponentModel' ) {
                        //If parent of parent is alternative, then only add if parent is in AA.
                        if ( self.shouldBeGenerated( parent ) ) {
                            id = 'id-' + self.core.getGuid( parent ) + '-' + self.core.getAttribute(
                                connectedPort, 'ID' );
                        }
                    } else if ( parentMetaType === 'Container' ) {
                        //If parent of parent is alternative, then only add if parent is in AA.
                        if ( self.shouldBeGenerated( parent ) ) {
                            id = self.core.getGuid( connectedPort );
                        }
                    } else if ( parentMetaType === 'Connector' ) {
                        grandParent = self.core.getParent( parent );
                        grandParentMetaType = self.core.getAttribute( self.getMetaType( grandParent ), 'name' );
                        if ( grandParentMetaType === 'Container' ) {
                            if ( self.shouldBeGenerated( grandParent ) ) {
                                id = self.core.getGuid( connectedPort );
                            }
                        } else {
                            callback( 'Unexpected Connector grandParentMetaType ' + grandParentMetaType );
                        }
                    } else {
                        callback( 'Unexpected Connector parentMetaType ' + parentMetaType );
                    }
                }
                callback( null, id );
            } );
        } else {
            self.createMessage( connectionNode, 'Connection with no src/dst exists in design.', 'error' );
            callback( 'A connection with only one direction pointer exists in model.' );
        }
    };
    //</editor-fold>

    //<editor-fold desc="=========================== Properties/ValueFlows ==========================">
    AdmExporter.prototype.addProperty = function ( node, parent, containerData, callback ) {
        var self = this,
            pos = self.core.getRegistry( node, 'position' ),
            parentType = self.core.getAttribute( self.getMetaType( parent ), 'name' ),
            collectionNames = self.core.getCollectionNames( node ),
            valueType = self.core.getAttribute( node, 'ValueType' ),
            dataType = self.core.getAttribute( node, 'DataType' ),
            unit,
            data,
            value,
            id,
            addPropertyData;

        addPropertyData = function ( valueSourceID ) {
            if ( parentType === 'Container' ) {
                id = self.core.getGuid( node );
                data = {
                    "@xsi:type": "q1:PrimitiveProperty",
                    "@Name": self.core.getAttribute( node, 'name' ),
                    "@ID": null,
                    "@XPosition": Math.floor( pos.x ),
                    "@YPosition": Math.floor( pos.y ),
                    "Value": {
                        "@ID": id,
                        "@DimensionType": "Scalar",
                        "@Dimensions": "",
                        "@DataType": dataType,
                        "ValueExpression": null
                    }
                };
                unit = self.core.getAttribute( node, 'Unit' );
                if ( unit ) {
                    data.Value[ '@Unit' ] = unit;
                }
                value = self.core.getAttribute( node, 'Value' ) || '';
                if ( valueType === 'Parametric' ) {
                    data[ '@ID' ] = 'param.' + id;
                    data.Value.ValueExpression = {
                        "@xsi:type": "q1:" + valueType + "Value",
                        "Default": {
                            "@xsi:type": "q1:FixedValue",
                            "Value": {
                                "#text": self.core.getAttribute( node, 'Default' ) || ''
                            }
                        },
                        "Maximum": {
                            "@xsi:type": "q1:FixedValue",
                            "Value": {
                                "#text": self.core.getAttribute( node, 'Maximum' ) || ''
                            }
                        },
                        "Minimum": {
                            "@xsi:type": "q1:FixedValue",
                            "Value": {
                                "#text": self.core.getAttribute( node, 'Minimum' ) || ''
                            }
                        },
                        "AssignedValue": null
                    };
                    if ( valueSourceID ) {
                        data.Value.ValueExpression.AssignedValue = {
                            "@xsi:type": "q1:DerivedValue",
                            "@ValueSource": valueSourceID
                        };
                    } else {
                        data.Value.ValueExpression.AssignedValue = {
                            "@xsi:type": "q1:FixedValue",
                            "Value": {
                                "#text": value
                            }
                        };
                    }
                } else if ( valueType === 'Fixed' ) {
                    data[ '@ID' ] = 'property.' + id;
                    if ( valueSourceID ) {
                        data.Value.ValueExpression = {
                            "@xsi:type": "q1:DerivedValue",
                            "@ValueSource": valueSourceID
                        };
                    } else {
                        data.Value.ValueExpression = {
                            "@xsi:type": "q1:FixedValue",
                            "Value": {
                                "#text": value
                            }
                        };
                    }
                } else {
                    self.logger.error( 'Unexpected property value type, ' + valueType );
                }
                containerData.Property.push( data );
            } else if ( parentType === 'AVMComponentModel' ) {
                id = self.core.getAttribute( node, 'ID' );
                data = {
                    "@IDinComponentModel": id,
                    "Value": {
                        "@ID": 'id-' + self.core.getGuid( parent ) + '-' + id,
                        "@DimensionType": "Scalar",
                        "@Dimensions": "",
                        "@DataType": dataType
                    }
                };
                if ( valueSourceID ) {
                    data.Value.ValueExpression = {
                        "@xsi:type": "q1:DerivedValue",
                        "@ValueSource": valueSourceID
                    };
                }
                containerData.PrimitivePropertyInstance.push( data );
            } else {
                self.logger.error( 'Unexpected parentType for property, ' + parentType );
            }

            callback( null );
        };
        if ( collectionNames.indexOf( 'dst' ) < 0 ) {
            addPropertyData( null );
        } else {
            self.core.loadCollection( node, 'dst', function ( err, valueFlows ) {
                if ( err ) {
                    callback( 'Could not load collection for ' + self.core.getAttribute( node, 'name' ) +
                        'err: ' + err.toString() );
                    return;
                }
                if ( valueFlows.length > 1 ) {
                    if ( self.core.getAttribute( parent, 'Type' ) !== 'Alternative' ) {
                        self.createMessage( node, self.core.getAttribute( node, 'name' ) +
                            ' had more than one incoming value', 'warning' );
                        callback( null );
                    } else if ( self.selectedAlternatives ) {
                        // With only one configuration or within a non-alternative container there should NOT be any muxes.
                        self.getValueSrcId( valueFlows, node, parent, function ( err, srcId ) {
                            if ( err ) {
                                callback(
                                    'Problems getting ValueSrcId in alternative for configuration, err: ' +
                                    err );
                            } else {
                                addPropertyData( srcId );
                            }
                        } );
                    } else {
                        self.addValueFlowMux( valueFlows, parent, containerData, function ( err, muxId ) {
                            if ( err ) {
                                self.createMessage( node, 'Property had multiple incoming value-flows.' +
                                    ' Failed to add valueFlow-mux for it.', 'error' );
                                callback( err );
                            } else {
                                addPropertyData( muxId );
                            }
                        } );
                    }
                } else {
                    self.getValueSrcId( valueFlows, node, parent, function ( err, srcId ) {
                        if ( err ) {
                            callback( 'Problems getting ValueSrcId, err: ' + err );
                        } else {
                            addPropertyData( srcId );
                        }
                    } );
                }
            } );
        }
    };

    AdmExporter.prototype.addFormula = function ( node, parent, containerData, isSimple, callback ) {
        var self = this,
            pos = self.core.getRegistry( node, 'position' ),
            collectionNames = self.core.getCollectionNames( node ),
            formulaName = self.core.getAttribute( node, 'name' ),
            data,
            id = self.core.getGuid( node ),
            addFormulaData;
        self.logger.info( 'At formula "' + formulaName + '".' );
        addFormulaData = function ( operands, error ) {
            var i;
            if ( isSimple ) {
                data = {
                    "@xmlns:q1": "avm",
                    "@xmlns": "",
                    "@xsi:type": "q1:SimpleFormula",
                    "@ID": id,
                    "@Name": formulaName,
                    "@XPosition": Math.floor( pos.x ),
                    "@YPosition": Math.floor( pos.y ),
                    "@Operation": self.core.getAttribute( node, 'Method' ),
                    "@Operand": ''
                };
                for ( i = 0; i < operands.length; i += 1 ) {
                    data[ "@Operand" ] = self.appendWhiteSpacedString( data[ "@Operand" ], operands[ i ].id );
                }
            } else {
                data = {
                    "@xmlns:q1": "avm",
                    "@xmlns": "",
                    "@xsi:type": "q1:ComplexFormula",
                    "@ID": id,
                    "@Name": formulaName,
                    "@XPosition": Math.floor( pos.x ),
                    "@YPosition": Math.floor( pos.y ),
                    "@Expression": self.core.getAttribute( node, 'Expression' ),
                    "Operand": []
                };
                for ( i = 0; i < operands.length; i += 1 ) {
                    data.Operand.push( {
                        "@Symbol": operands[ i ].symbol,
                        "@ValueSource": operands[ i ].id
                    } );
                }
            }
            containerData.Formula.push( data );
            callback( error );
        };

        if ( collectionNames.indexOf( 'dst' ) < 0 ) {
            addFormulaData( null );
        } else {
            self.core.loadCollection( node, 'dst', function ( err, valueFlows ) {
                var counter = valueFlows.length,
                    i,
                    error = '',
                    operands = [],
                    counterCallback;
                if ( err ) {
                    callback( 'Could not load collection for ' + formulaName + 'err: ' + err.toString() );
                    return;
                }
                counter = valueFlows.length;
                counterCallback = function ( valueFlow ) {

                    return function ( err, valueSource ) {
                        var symbol,
                            valueSourceId,
                            valueSourceParent,
                            parentMetaType;

                        if ( err ) {
                            error += err;
                        } else {
                            valueSourceParent = self.core.getParent( valueSource );
                            parentMetaType = self.core.getAttribute( self.getMetaType( valueSourceParent ),
                                'name' );
                            if ( parentMetaType === 'AVMComponentModel' ) {
                                if ( self.shouldBeGenerated( valueSourceParent ) ) {
                                    valueSourceId = 'id-' + self.core.getGuid( valueSourceParent ) + '-' + self
                                        .core.getAttribute( valueSource, 'ID' );
                                }
                            } else if ( parentMetaType === 'Container' ) {
                                //If parent of parent is alternative, then only add if parent is in AA.
                                if ( self.shouldBeGenerated( valueSourceParent ) ) {
                                    valueSourceId = self.core.getGuid( valueSource );
                                }
                            } else {
                                self.logger.error( 'Unexpected parentMetaType of valueSourceNode' +
                                    parentMetaType );
                            }

                            if ( !isSimple ) {
                                symbol = self.core.getAttribute( valueFlow, 'VariableName' );
                                if ( !symbol ) {
                                    symbol = self.core.getAttribute( valueSource, 'name' );
                                }
                            }
                            if ( valueSourceId ) {
                                operands.push( {
                                    symbol: symbol,
                                    id: valueSourceId
                                } );
                            }
                        }
                        counter -= 1;
                        if ( counter <= 0 ) {
                            addFormulaData( operands, error );
                        }
                    };
                };
                if ( counter === 0 ) {
                    self.logger.warning( 'Formula "' + formulaName + '" did not have any incoming value flows.' );
                    addFormulaData( [], error );
                }
                for ( i = 0; i < valueFlows.length; i += 1 ) {
                    if ( self.core.hasPointer( valueFlows[ i ], 'src' ) ) {
                        self.core.loadPointer( valueFlows[ i ], 'src', counterCallback( valueFlows[ i ] ) );
                    } else {
                        self.createMessage( valueFlows[ i ],
                            'ValueFlow Connection with no src exists in design.', 'error' );
                        counterCallback( valueFlows[ i ] )(
                            'A valueFlow with only one direction pointer exists in model.' );
                    }
                }
            } );
        }
    };

    AdmExporter.prototype.addValueFlowMux = function ( valueFlows, parent, containerData, callback ) {
        var self = this,
            i,
            counter = valueFlows.length,
            s4 = function () {
                return Math.floor( ( 1 + Math.random() ) * 0x10000 )
                    .toString( 16 )
                    .substring( 1 );
            },
            mux = {
                '@ID': 'muxid-' + s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4(),
                '@Source': ''
            },
            error = '',
            counterCallback = function ( err, valueSource ) {
                var valueSourceId,
                    valueSourceParent,
                    parentMetaType;

                if ( err ) {
                    error += err;
                } else {
                    valueSourceParent = self.core.getParent( valueSource );
                    parentMetaType = self.core.getAttribute( self.getMetaType( valueSourceParent ), 'name' );
                    if ( parentMetaType === 'AVMComponentModel' ) {
                        valueSourceId = 'id-' + self.core.getGuid( valueSourceParent ) + '-' + self.core.getAttribute(
                            valueSource, 'ID' );
                    } else if ( parentMetaType === 'Container' ) {
                        valueSourceId = self.core.getGuid( valueSource );
                    } else {
                        self.logger.error( 'Unexpected parentMetaType of valueSourceNode' + parentMetaType );
                    }
                    mux[ '@Source' ] = self.appendWhiteSpacedString( mux[ '@Source' ], valueSourceId );
                }
                counter -= 1;
                if ( counter <= 0 ) {
                    callback( error, mux[ '@ID' ] );
                }
            };

        containerData.ValueFlowMux.push( mux );
        for ( i = 0; i < valueFlows.length; i += 1 ) {
            if ( self.core.hasPointer( valueFlows[ i ], 'src' ) ) {
                self.core.loadPointer( valueFlows[ i ], 'src', counterCallback );
            } else {
                self.createMessage( valueFlows[ i ], 'ValueFlow Connection with no src exists in design.', 'error' );
                counterCallback( 'A valueFlow with only one direction pointer exists in model.' );
            }
        }
    };

    AdmExporter.prototype.getValueSrcId = function ( valueFlows, targetNode, targetParent, callback ) {
        var self = this,
            error = '',
            i,
            finalSrcId,
            counter = valueFlows.length,
            parentType = self.core.getAttribute( self.getMetaType( targetParent ), 'name' ),
            atValueFlowNode = function ( valueFlow ) {
                var srcId;
                counter -= 1;
                if ( !self.core.hasPointer( valueFlow, 'src' ) ) {
                    self.createMessage( valueFlow, 'ValueFlow Connection with no src exists in design.', 'error' );
                    error += 'A valueFlow with only one direction pointer exists in model.';
                    if ( counter <= 0 ) {
                        callback( error, null );
                    }
                } else {
                    self.core.loadPointer( valueFlow, 'src', function ( err, valueSourceNode ) {
                        var src,
                            srcParentMetaType;
                        if ( err ) {
                            error += 'Could not load src pointer for ' + self.core.getAttribute( valueFlow,
                                'name' ) + 'err: ' + err.toString();
                        } else if ( self.nodeIsWithinDesign( valueSourceNode ) ) {
                            src = self.core.getParent( valueSourceNode );
                            srcParentMetaType = self.core.getAttribute( self.getMetaType( src ), 'name' );
                            if ( srcParentMetaType === 'AVMComponentModel' ) {
                                if ( parentType === 'AVMComponentModel' && self.core.getPath( src ) === self.core
                                    .getPath( targetParent ) ) {
                                    self.logger.info( 'Skipping connection within same ACM : ' +
                                        self.core.getAttribute( targetNode, 'name' ) );
                                } else {
                                    // If parent of parent is alternative, then only add if parent is in AA.
                                    if ( self.shouldBeGenerated( src ) ) {
                                        srcId = 'id-' + self.core.getGuid( src ) + '-' + self.core.getAttribute(
                                            valueSourceNode, 'ID' );
                                    }
                                }
                            } else if ( srcParentMetaType === 'Container' ) {
                                //If parent of parent is alternative, then only add if parent is in AA.
                                if ( self.shouldBeGenerated( src ) ) {
                                    srcId = self.core.getGuid( valueSourceNode );
                                }
                            } else {
                                self.logger.error( 'Unexpected parentMetaType of valueSourceNode' +
                                    srcParentMetaType );
                            }
                        }
                        if ( srcId ) {
                            if ( finalSrcId ) {
                                self.createMessage( targetNode, 'Cannot have more than one incoming value.',
                                    'error' );
                                error += 'There is more than one incoming value..';
                            } else {
                                finalSrcId = srcId;
                            }
                        }
                        if ( counter <= 0 ) {
                            callback( error, finalSrcId );
                        }
                    } );
                }
            };
        for ( i = 0; i < valueFlows.length; i += 1 ) {
            atValueFlowNode( valueFlows[ i ] );
        }
    };
    //</editor-fold>

    AdmExporter.prototype.loadSetMembers = function ( node, setName, callback ) {
        var self = this;
        var pointedIds = self.core.getMemberPaths( node, setName );
        var pointedNodes = [];
        var error = '';


        function getLoadCallback( i ) {
            return function ( err, pointedNode ) {
                if ( err ) {
                    error += err;
                }
                pointedNodes[ i ] = pointedNode;
                counter--;
                if ( counter === 0 ) {
                    callback( error, pointedNodes, pointedIds );
                    counter--;
                }
            };
        }
        var counter = pointedIds.length;
        for ( var i = 0; i < pointedIds.length; i += 1 ) {
            if ( self.startsWith( pointedIds[ i ], self.rootPath ) ) {
                self.core.loadByPath( self.rootNode, pointedIds[ i ], getLoadCallback( i ) );
            } else {
                counter--;
                pointedNodes[ i ] = null;
                // self.logger.warning('AssemblyRoot selection is not within design, see path "' + componentIds[i] + '".');
            }
        }
        if ( counter === 0 ) {
            callback( null, pointedNodes, pointedIds );
            counter--;
        }
    };

    AdmExporter.prototype.addAssemblyRoot = function ( node, parent, containerData, callback ) {
        var self = this;
        self.loadSetMembers( node, 'Selection', function ( err, componentNodes, componentIds ) {
            var componentNode,
                i;
            if ( err ) {
                callback( 'Failed loading node from AssemblyRoot ' + err.toString() );
            } else {
                for ( i = 0; i < componentNodes.length; i++ ) {
                    componentNode = componentNodes[ i ];
                    if ( componentNode ) {
                        if ( self.shouldBeGenerated( componentNode ) ) {
                            //<DomainFeature xmlns:q3="cad" xmlns="" xsi:type="q3:AssemblyRoot"
                            // AssemblyRootComponentInstance="{9267c3e4-a944-4a68-85a8-c90dfb5a428c}" />
                            if ( self.admData.DomainFeature ) {
                                // TODO: Append the selection here when format updated.
                                self.logger.warning(
                                    'Only one AssemblyRoot can be exported, an arbitrary selection will be made!'
                                );
                                self.admData.DomainFeature[ '@AssemblyRootComponentInstance' ] = self.core.getGuid(
                                    componentNode );
                            } else {
                                self.admData.DomainFeature = {
                                    '@xmlns:q1': 'cad',
                                    '@xmlns': '',
                                    '@xsi:type': 'q1:AssemblyRoot',
                                    '@AssemblyRootComponentInstance': self.core.getGuid( componentNode )
                                };
                            }
                        } else {
                            self.logger.info( 'Skipping AssemblyRoot Selection of "' + self.core.getPath(
                                componentNode ) + '".' );
                        }
                    } else {
                        self.logger.warning( 'AssemblyRoot selection is not within design, see path "' +
                            componentIds[ i ] + '".' );
                    }
                }
                callback( null );
            }
        } );
    };

    AdmExporter.prototype.visitAllChildrenFromRootContainer = function ( rootNode, callback ) {
        var self = this,
            error = '',
            counter,
            counterCallback,
            containerData;

        counter = {
            visits: 1
        };
        counterCallback = function ( err ) {
            error = err ? error + err : error;
            counter.visits -= 1;
            if ( counter.visits === 0 ) {
                callback( error === '' ? undefined : error );
            }
        };

        containerData = self.getContainerData( rootNode, true );
        self.admData.RootContainer = containerData;
        self.visitAllChildrenRec( rootNode, counter, containerData, counterCallback );
    };

    AdmExporter.prototype.visitAllChildrenRec = function ( node, counter, containerData, callback ) {
        var self = this;
        self.core.loadChildren( node, function ( err, children ) {
            var i,
                atModelNodeCallback;
            if ( err ) {
                callback( 'loadChildren failed for ' + self.core.getAttribute( node, 'name' ) );
                return;
            }
            if ( children.length === 0 ) {
                callback( null );
            } else {
                counter.visits += children.length;
                counter.visits -= 1;
                atModelNodeCallback = function ( childNode ) {
                    return function ( err ) {
                        var subContainerData;
                        if ( err ) {
                            callback( err );
                            return;
                        }
                        if ( self.isMetaTypeOf( childNode, self.meta.Container ) && self.shouldBeGenerated(
                            childNode ) ) {
                            // If containerData is Alternative, then only add if childNode.id is in AA.
                            subContainerData = self.getContainerData( childNode );
                            containerData.Container.push( subContainerData );
                            self.visitAllChildrenRec( childNode, counter, subContainerData, callback );
                        } else {
                            callback( null );
                        }
                    };
                };
                for ( i = 0; i < children.length; i += 1 ) {
                    self.atModelNode( children[ i ], node, containerData, atModelNodeCallback( children[ i ] ) );
                }
            }
        } );
    };

    AdmExporter.prototype.getContainerData = function ( node, isRoot ) {
        var self = this,
            pos,
            containerData = {
                "@xmlns:q1": "avm",
                "@xsi:type": 'q1:' + self.core.getAttribute( node, 'Type' ),
                "@Name": self.core.getAttribute( node, 'name' ),
                "@xmlns": "",
                "Container": [],
                "Property": [],
                "ComponentInstance": [],
                "Port": [],
                "Connector": [],
                "JoinData": [],
                "Formula": [],
                "ValueFlowMux": []
            };

        if ( !isRoot ) {
            pos = self.core.getRegistry( node, 'position' );
            containerData[ "@XPosition" ] = Math.floor( pos.x );
            containerData[ "@YPosition" ] = Math.floor( pos.y );
        }

        return containerData;
    };

    AdmExporter.prototype.getConnectorData = function ( node, parent ) {
        var self = this,
            pos,
            parentType = self.core.getAttribute( self.getMetaType( parent ), 'name' ),
            data;

        if ( parentType === 'Container' ) {
            pos = self.core.getRegistry( node, 'position' );
            data = {
                "@Name": self.core.getAttribute( node, 'name' ),
                "@ID": self.core.getGuid( node ),
                "@ConnectorComposition": '',
                "@ApplyJoinData": '',
                "@Definition": '',
                "@XPosition": Math.floor( pos.x ),
                "@YPosition": Math.floor( pos.y ),
                "Role": []
            };
        } else if ( parentType === 'AVMComponentModel' ) {
            data = {
                "@ID": 'id-' + self.core.getGuid( parent ) + '-' + self.core.getAttribute( node, 'ID' ),
                "@IDinComponentModel": self.core.getAttribute( node, 'ID' ),
                "@ConnectorComposition": '',
                "@ApplyJoinData": ''
            };
        } else {
            self.logger.error( 'Unexpected parent-type, ' + parentType + ', of connector.' );
            data = {};
        }

        return data;
    };

    AdmExporter.prototype.getDomainPortData = function ( node, parent ) {
        var self = this,
            typeName = self.core.getAttribute( node, 'Type' ),
            domainNodeName = self.core.getAttribute( node, 'name' ),
            parentType = self.core.getAttribute( self.getMetaType( parent ), 'name' ),
            data,
            pos,
            attributes,
            attr;

        if ( parentType === 'Container' || parentType === 'Connector' ) {
            pos = self.core.getRegistry( node, 'position' );
            data = {
                '@ID': self.core.getGuid( node ),
                '@PortMap': '',
                '@Name': domainNodeName,
                '@Notes': '',
                '@Definition': '',
                "@XPosition": Math.floor( pos.x ),
                "@YPosition": Math.floor( pos.y )
            };
            if ( typeName === 'ModelicaConnector' ) {
                attributes = {
                    '@xmlns:q1': 'modelica',
                    '@xsi:type': 'q1:Connector',
                    '@Locator': domainNodeName,
                    '@Class': self.core.getAttribute( node, 'Class' )
                };
            } else if ( typeName === 'CadAxis' ) {
                attributes = {
                    '@xmlns:q1': 'cad',
                    '@xsi:type': 'q1:Axis',
                    '@DatumName': ''
                };
            } else if ( typeName === 'CadCoordinateSystem' ) {
                attributes = {
                    '@xmlns:q1': 'cad',
                    '@xsi:type': 'q1:CoordinateSystem',
                    '@DatumName': ''
                };
            } else if ( typeName === 'CadPlane' ) {
                attributes = {
                    '@xmlns:q1': 'cad',
                    '@xsi:type': 'q1:Plane',
                    '@DatumName': '',
                    '@SurfaceReverseMap': ''
                };
            } else if ( typeName === 'CadPoint' ) {
                attributes = {
                    '@xmlns:q1': 'cad',
                    '@xsi:type': 'q1:Point',
                    '@DatumName': ''
                };
            }
            for ( attr in attributes ) {
                if ( attributes.hasOwnProperty( attr ) ) {
                    data[ attr ] = attributes[ attr ];
                }
            }
        } else if ( parentType === 'AVMComponentModel' ) {
            data = {
                '@ID': 'id-' + self.core.getGuid( parent ) + '-' + self.core.getAttribute( node, 'ID' ),
                '@PortMap': '',
                '@IDinComponentModel': self.core.getAttribute( node, 'ID' )
            };
        } else {
            self.logger.error( 'Unexpected parent-type, ' + parentType + ', of domainPort.' );
            data = {};
        }

        return data;
    };

    AdmExporter.prototype.appendWhiteSpacedString = function ( toBeAppended, appendix ) {
        if ( appendix ) {
            if ( toBeAppended ) {
                toBeAppended += " " + appendix;
            } else {
                toBeAppended = appendix;
            }
        }
        return toBeAppended;
    };

    AdmExporter.prototype.nodeIsWithinDesign = function ( node ) {
        var self = this,
            path = self.core.getPath( node );
        if ( self.startsWith( path, self.rootPath ) ) {
            return true;
        }
        self.logger.info( 'Connection to node with path ' + path + ' will not be generated.' +
            'It is not part of the root-design' );
        return false;
    };

    AdmExporter.prototype.startsWith = function ( str, start ) {
        if ( start === '' ) {
            return true;
        }
        return start.length > 0 && str.substring( 0, start.length ) === start;
    };

    return AdmExporter;
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/TestBenchRunner/TestBenchRunner/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/* global define,require */
/* Generated file based on ejs templates */
define( 'plugin/TestBenchRunner/TestBenchRunner/Templates/Templates',[], function () {
    return {
        "execute.py.ejs": "import os\nimport sys\nimport json\nimport shutil\nimport errno\nimport zipfile\nimport logging\nimport subprocess\nimport pywintypes\nimport win32com.client\n## Setup a logger\nlogger = logging.getLogger()\nlogger.setLevel(logging.DEBUG)\n\n# Create file handler which logs even debug messages.\nif not os.path.isdir('log'):\n    os.mkdir('log')\n\nfh = logging.FileHandler(os.path.join('log', 'execute.log'))\nfh.setLevel(logging.DEBUG)\n\n# Create console handler to stdout with logging level info.\nch = logging.StreamHandler(sys.stdout)\nch.setLevel(logging.INFO)\n\n# Create console handler to stderr with logging level error.\nch_err = logging.StreamHandler()\nch_err.setLevel(logging.ERROR)\n\n# Create formatter and add it to the handlers.\nformatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')\nfh.setFormatter(formatter)\nch.setFormatter(formatter)\nch_err.setFormatter(formatter)\n\n# Add the handlers to the logger.\nlogger.addHandler(fh)\nlogger.addHandler(ch)\nlogger.addHandler(ch_err)\n\ndef close_log():\n    fh.close()\nimport atexit\natexit.register(close_log)\n\n## Obtain the root directory for the META-tools.\n# Get the running meta-python path.\nsys_pieces = sys.executable.split(os.path.sep)\n# Drop the 'bin/Python27/Scripts/python.exe' part.\nif len(sys_pieces) < 4:\n    logger.error('Python script must be called using the META-python virtual env!')\n    sys.exit(1)\nsys_pieces = sys_pieces[:-4]\n# Make sure to get the slashes after e.g. \"C:\".\nif sys_pieces[0].endswith(':'):\n    sys_pieces[0] = sys_pieces[0] + os.path.sep\n# Join the pieces.\nMETA_DIR = os.path.join(*sys_pieces)\n\n# Disable early binding: full of race conditions writing the cache files,\n# and changes the semantics since inheritance isn't handled correctly\nimport win32com.client.gencache\n_savedGetClassForCLSID = win32com.client.gencache.GetClassForCLSID\nwin32com.client.gencache.GetClassForCLSID = lambda x: None\n\n\ndef call_subprocess_with_logging(command, my_env=None):\n    \"\"\"\n    Calls the command, if error occurred logging is made of all non-empty returns.\n    Reraises the exception putting the formatted message in returncode\n\n    :param command: the command to be executed\n    :param my_env: dictionary of environment-variables, None -> uses the default windows\n    \"\"\"\n    logger.info(\"About to call : {0}\".format(command))\n    return_code = 0\n    try:\n        if my_env:\n            return_out = subprocess.check_output(command, stderr=subprocess.STDOUT, env=my_env, shell=True)\n        else:\n            return_out = subprocess.check_output(command, stderr=subprocess.STDOUT, shell=True)\n        logger.info('console output : \\n{0}'.format(return_out))\n    except subprocess.CalledProcessError as err:\n        msg = \"Subprocess call failed!\"\n        msg += \"\\n  return-code   : {0}\".format(err.returncode)\n        return_code = err.returncode\n        if err.output:\n            msg += \"\\n  console output: \\n\\n{0}\".format(err.output)\n        if err.message:\n            msg += \"\\n  error message : {0}\".format(err.message)\n        logger.error(msg)\n\n    return return_code\n\n\n\ndef parse_xme_and_save_to_mga(file_name):\n    \"\"\"\n    Imports the xme project and saves it to a mga-file with the same name.\n    (Will overwrite any existing mga with same path.)\n\n    returns : mga_path : path to newly created mga\n    \"\"\"\n    mga_file = file_name[:-4] + '.mga'\n    mga_path = os.path.abspath(mga_file)\n    logger.debug(\"About to parse .xme, mga will be saved to \" + mga_path)\n    parser = win32com.client.Dispatch('Mga.MgaParser')\n    (paradigm, paradigm_v, paradigm_guid, basename, version) = parser.GetXMLInfo(file_name)\n    logger.debug('Xme info :')\n    logger.debug('  paradigm     : {0}'.format(paradigm))\n    logger.debug('  paradigm_v   : {0}'.format(paradigm_v))\n    import uuid\n    logger.debug('  paradigm_guid: {0}'.format(str(uuid.UUID(bytes_le=paradigm_guid))))\n    logger.debug('  basename     : {0}'.format(basename))\n    logger.debug('  version      : {0}'.format(version))\n    if paradigm != 'CyPhyML':\n        raise IOError(\"Given xme file must be using CyPhyML as paradigm, not {0}\".format(paradigm))\n\n    project = win32com.client.Dispatch('Mga.MgaProject')\n    project.Create('MGA={0}'.format(mga_path), paradigm)\n    try:\n        parser.ParseProject(project, file_name)\n        project.Save()\n        logging.debug(\"Mga saved to \" + mga_file)\n    finally:\n        project.Close(True)\n\n    return mga_path\n\n\ndef extract_components(src_path='ACMs', dst_path='components_extracted'):\n    if os.path.isdir(dst_path):\n        logging.debug('Found dir :{0} - removing and making new...'.format(dst_path))\n        shutil.rmtree(dst_path)\n        os.mkdir(dst_path)\n    files = os.listdir(src_path)\n    logging.debug('Components found in directory : {0}'.format(files))\n    for f_name in files:\n        if f_name.endswith('.zip'):\n            zippy = zipfile.ZipFile(os.path.join(src_path, f_name))\n            zippy.extractall('\\\\\\\\?\\\\' + os.path.join(os.getcwd(), dst_path, f_name.rstrip('.zip')))\n\n\ndef import_components(mga_path, dir_path='components_extracted'):\n    exec_name = 'CyPhyComponentImporterCL.exe'\n    exec_path = os.path.join(META_DIR, 'bin', exec_name)\n    if not os.path.isfile(exec_path):\n        logging.debug('Did not find {0} in bin directory.'.format(exec_name))\n        logging.debug('Assuming developer machine, looking in src directory...'.format(exec_name))\n        exec_path = os.path.join(META_DIR, 'src', 'CyPhyComponentImporterCL', 'bin', 'Release', exec_name)\n        if not os.path.isfile(exec_path):\n            raise IOError('Did not find {0}'.format(exec_path))\n\n    command = '\"{0}\" -r \"{1}\" \"{2}\"'.format(exec_path, dir_path, mga_path)\n    rc = call_subprocess_with_logging(command)\n\n    return rc\n\n\ndef import_design(mga_path, adm_file, testbench_config):\n    project_conn_str = 'MGA={0}'.format(mga_path)\n    project = win32com.client.Dispatch('Mga.MgaProject')\n    project.Open(project_conn_str)\n    design_ids = []\n    is_in_transaction = False\n    try:\n        design_importer = win32com.client.Dispatch('MGA.Interpreter.CyPhyDesignImporter')\n        design_importer.Initialize(project)\n        logger.debug('About to begin transaction..')\n        project.BeginTransactionInNewTerr()\n        logger.debug('Transaction began.')\n        is_in_transaction = True\n        ## Find the test-bench and find the design placeholder.\n        testbench_mga = project.ObjectByPath(testbench_config['path'])\n        if not testbench_mga:\n            raise RuntimeError('Given test-bench path \"' + testbench_config['path'] + '\" does not exist in project!')\n        try:\n            logger.debug('Path returned MgaObject of type: {0}'.format(testbench_mga.MetaBase.Name))\n            #if not testbench_mga.MetaBase.Name == 'TestBench':\n            #    raise NotImplementedError('Only CyPhy TestBench supported!')\n            testbench_id = testbench_mga.ID\n            logger.debug('Found test-bench \"{0}\".'.format(testbench_mga.Name))\n            logger.debug('Test-bench ID : {0}.'.format(testbench_id))\n            tlsut_mga = [o for o in testbench_mga.GetChildrenOfKind('TopLevelSystemUnderTest')]\n            if tlsut_mga:\n                tlsut_mga = tlsut_mga[0]\n            else:\n                tlsut_role = testbench_mga.Meta.GetRoleByNameDisp('TopLevelSystemUnderTest')\n                tlsut_mga = testbench_mga.CreateChildObject(tlsut_role)\n            logger.debug('TopLevelSystem under test {0} name :'.format(tlsut_mga.Name))\n            if tlsut_mga.Referred:\n                logger.debug(' \"{0}\" ({1})'.format(tlsut_mga.Referred.Name, tlsut_mga.Referred.MetaBase.Name))\n            else:\n                logger.debug(' [null reference]')\n        except pywintypes.com_error as err:\n            logger.error(err.message)\n            raise RuntimeError('Given test-bench not found or setup correctly.')\n        ## Import the design.\n        logger.debug('Calling CyPhyDesignImporter.ImportDesign.')\n        design_mga = design_importer.ImportDesignToDesignSpaceIfApplicable(project, adm_file)\n        design_id = design_mga.ID\n        logger.debug('Design imported:')\n        logger.debug(' Name : {0}'.format(design_mga.Name))\n        logger.debug(' Type : {0}'.format(design_mga.MetaBase.Name))\n        logger.debug(' ID : {0}'.format(design_id))\n        logger.debug(' Path : {0}'.format(design_mga.AbsPath))\n\n        if design_mga.MetaBase.Name == 'DesignContainer':\n            logger.info('Creating DesignSpaceHelper')\n            desert = win32com.client.Dispatch('MGA.Interpreter.DesignSpaceHelper')\n            desert.Initialize(project)\n            logger.info('Calling ApplyConstraintsAndGenerateCWCs')\n            # selectedObjs = win32com.client.Dispatch('Mga.MgaFCOs')\n            desert.ApplyConstraintsAndGenerateCWCs(project, design_mga, False)\n            configurations = design_mga.GetChildrenOfKind('Configurations')\n            if configurations.Count == 0:\n                logger.warning('No Configurations found')\n            for cc in configurations:\n                logger.info('Found Configurations \"{0}\" inside design.'.format(cc.Name))\n                cfg_mgas = cc.GetChildrenOfKind('CWC')\n                for cfg_mga in cfg_mgas:\n                    logger.info(cfg_mga.AbsPath)\n                    design_ids.append(cfg_mga.ID)\n        else:\n            design_ids.append(design_id)\n        ## Reference the design from the top-level-system-under-test.\n        logger.debug('Creating ReferenceSwitcher')\n        ref_switcher = win32com.client.Dispatch('MGA.Interpreter.ReferenceSwitcher')\n        logger.debug('Switching referred in test-bench to design.')\n        tlsut_mga.Name = design_mga.Name\n        ref_switcher.SwitchReference(design_mga, tlsut_mga)\n        logger.debug('Design was placed in test-bench.')\n        logger.debug('About to commit transaction..')\n        project.CommitTransaction()\n        logger.debug('Transaction committed.')\n        is_in_transaction = False\n    finally:\n        if is_in_transaction:\n            logger.debug('About to abort transaction..')\n            project.AbortTransaction()\n            logger.debug('Transaction aborted.')\n            project.Close(True)\n        else:\n            logger.debug('About to save project..')\n            project.Close(False)\n            logger.debug('Project saved.')\n\n    return testbench_id, design_ids\n\n\ndef call_master_interpreter(mga_path, test_bench_id, cfg_ids):\n    project_conn_str = 'MGA={0}'.format(mga_path)\n    project = win32com.client.Dispatch('Mga.MgaProject')\n    project.Open(project_conn_str)\n    nbr_of_failures = 0\n    nbr_of_cfgs = 0\n    try:\n        logger.debug('Creating CyPhyMasterInterpreterAPI')\n        mi = win32com.client.Dispatch('CyPhyMasterInterpreter.CyPhyMasterInterpreterAPI')\n        mi.Initialize(project)\n        logger.debug('Creating ConfigurationSelectionLight')\n        config_light = win32com.client.Dispatch('CyPhyMasterInterpreter.ConfigurationSelectionLight')\n        config_light.ContextId = test_bench_id\n        config_light.SetSelectedConfigurationIds(cfg_ids)\n        config_light.KeepTemporaryModels = False\n        config_light.PostToJobManager = False\n        mi_results = mi.RunInTransactionWithConfigLight(config_light)\n        mi.WriteSummary(mi_results)\n\n        for res in mi_results:\n            nbr_of_cfgs += 1\n            logger.info('MasterInterpreter result : {0}'.format(res.Message))\n            if not res.Success:\n                logger.error('MasterIntpreter failed : {0}, Exception : {1}'.format(res.Message, res.Exception))\n                nbr_of_failures += 1\n        if nbr_of_failures > 0:\n            with open('_FAILED.txt', 'ab+') as f_out:\n                f_out.write('MasterInterprter failed on ' + str(nbr_of_failures) + ' out of ' + str(nbr_of_cfgs) +\n                            ' configurations. See log/execution.log and log/MasterInerpter.xxxx.log for more info.')\n    finally:\n        project.Close(True)\n\n    if nbr_of_failures == nbr_of_cfgs:\n        logger.error('No succeeded configurations from MasterInterpreter, aborting script..')\n        sys.exit(1)\n\n\ndef run_execution_jobs():\n    jobs = []\n    for root, dirs, files in os.walk('results'):\n        for f in files:\n            if f == 'testbench_manifest.json':\n                with open(os.path.join(root, 'testbench_manifest.json'), 'r') as f_in:\n                    tb_dict = json.load(f_in)\n                    if len(tb_dict['Steps']) == 0:\n                        logger.warning('Skipping job for design ' + tb_dict['DesignID'] + ' in ' + root +\n                                       ', since there are no steps. MasterInterpreter probably failed on this design.')\n                    else:\n                        cmd = tb_dict['Steps'][0]['Invocation']\n                        logger.info('Found cmd {0}'.format(cmd))\n                        job = {'cmd': cmd, 'dir': root, 'designId': tb_dict['DesignID']}\n                        jobs.append(job)\n                        logger.info('Added job {0}'.format(job))\n                break\n    root_dir = os.getcwd()\n    if os.path.isdir('testbench_manifests'):\n        shutil.rmtree('testbench_manifests')\n    os.mkdir('testbench_manifests')\n    failed_jobs = 0\n    nbr_of_jobs = len(jobs)\n    for job in jobs:\n        os.chdir(job['dir'])\n        try:\n            rc = call_subprocess_with_logging(job['cmd'])\n            if rc != 0:\n                logger.error('call failed! {0} in {1}'.format(job['cmd'], job['dir']))\n                failed_jobs += 1\n            elif os.path.isfile('_FAILED.txt'):\n                logger.error('Job \"{0}\" created _FAILED.txt'.format(job['cmd']))\n                failed_jobs += 1\n                with open('_FAILED.txt', 'r') as f_in:\n                    logger.error('\\r\\n'.join(f_in.readlines()))\n        finally:\n            os.chdir(root_dir)\n    if failed_jobs > 0:\n        with open('_FAILED.txt', 'ab+') as f_out:\n            f_out.write(str(failed_jobs) + ' of ' + str(nbr_of_jobs) +' jobs failed! See log/execute.log.')\n\n\ndef move_dashboard_files(new_dir):\n\n    # Entire directories\n    dashboard_dir = 'dashboard'\n    designs_dir = 'designs'\n    design_space_dir = 'design-space'\n    requirements_dir = 'requirements'\n    test_benches_dir = 'test-benches'\n    results_dir = 'results'\n\n    # Single files\n    meta_results_file = os.path.join(results_dir, 'results.metaresults.json')\n    project_file = 'manifest.project.json'\n    index_html = 'index.html'\n\n    # Delete/Create new result directory.\n    if os.path.isdir(new_dir):\n        shutil.rmtree(new_dir)\n    os.mkdir(new_dir)\n    os.mkdir(os.path.join(new_dir, results_dir))\n    # Copy single files.\n    shutil.copy(meta_results_file, os.path.join(new_dir, meta_results_file))\n    shutil.copy(project_file, os.path.join(new_dir, project_file))\n    shutil.copy(index_html, os.path.join(new_dir, index_html))\n    # Copy entire directories.\n    shutil.copytree(dashboard_dir, os.path.join(new_dir, dashboard_dir))\n    shutil.copytree(designs_dir, os.path.join(new_dir, designs_dir))\n    shutil.copytree(design_space_dir, os.path.join(new_dir, design_space_dir))\n    shutil.copytree(requirements_dir, os.path.join(new_dir, requirements_dir))\n    shutil.copytree(test_benches_dir, os.path.join(new_dir, test_benches_dir))\n\n    for dir_path in (os.path.join(results_dir, dd) for dd in os.listdir(results_dir)):\n        if os.path.isdir(dir_path):\n            tm_path = os.path.join(dir_path, 'testbench_manifest.json')\n            if os.path.isfile(tm_path):\n                os.mkdir(os.path.join(new_dir, dir_path))\n                shutil.copy(tm_path, os.path.join(new_dir, tm_path))\n\n\nif __name__ == '__main__':\n    try:\n        shutil.rmtree('results')\n    except OSError as e:\n        if e.errno != errno.ENOENT:\n            raise\n    with zipfile.ZipFile('tbAsset.zip') as zippy:\n        zippy.extractall('.')\n    try:\n        adm_path = [f for f in os.listdir('.') if f.endswith('.adm')][0]\n    except IndexError:\n        logger.error('Could not find an adm at {0}'.format(os.getcwd()))\n        with open('_FAILED.txt', 'ab+') as f_out:\n            f_out.write('Execution failed! See log/execute.log.')\n        sys.exit(1)\n    try:\n        xme_path = [f for f in os.listdir('.') if f.endswith('.xme')][0]\n    except IndexError:\n        logger.error('Could not find an adm or xme file at {0}'.format(os.getcwd()))\n        with open('_FAILED.txt', 'ab+') as f_out:\n            f_out.write('Execution failed! See log/execute.log.')\n        sys.exit(1)\n    with open('testbench_config.json', 'r') as f_in:\n        test_bench_config = json.load(f_in)\n    extract_components()\n    logger.info('(1) Components extracted...')\n    mga_file = parse_xme_and_save_to_mga(xme_path)\n    logger.info('(2) Mga created...')\n    rc = import_components(mga_file)\n    if rc == 0:\n        logger.info('(3) Components imported...')\n    else:\n        logger.error('Components could not be imported!')\n        with open('_FAILED.txt', 'ab+') as f_out:\n            f_out.write('Execution failed! See log/execute.log.')\n        sys.exit(1)\n    try:\n        test_bench_id, cfg_ids = import_design(mga_file, adm_path, test_bench_config)\n    except Exception as err:\n        import traceback\n        the_trace = traceback.format_exc()\n        logger.error('Exception raised in \"import_design\": {0}'.format(the_trace))\n        error_msg = err.message\n        if hasattr(err, 'excepinfo'):\n            error_msg = '{0} : {1}'.format(error_msg, err.excepinfo)\n        with open('_FAILED.txt', 'ab+') as f_out:\n            f_out.write('Could not import design and place it correctly in test-bench. Exception message : ' +\n                        error_msg + ' See logs for more info.')\n            sys.exit(1)\n\n    logger.info('(4) Design imported and placed in test-bench.')\n    call_master_interpreter(mga_file, test_bench_id, cfg_ids)\n    logger.info('(5) MasterInterpreter finished.')\n    run_execution_jobs()\n    logger.info('(6) Job execution completed.')\n",
        "run_execution.cmd.ejs": ":: Executes the package\necho off\npushd %~dp0\n%SystemRoot%\\SysWoW64\\REG.exe query \"HKLM\\software\\META\" /v \"META_PATH\"\n\nSET QUERY_ERRORLEVEL=%ERRORLEVEL%\n\nIF %QUERY_ERRORLEVEL% == 0 (\n        FOR /F \"skip=2 tokens=2,*\" %%A IN ('%SystemRoot%\\SysWoW64\\REG.exe query \"HKLM\\software\\META\" /v \"META_PATH\"') DO SET META_PATH=%%B)\nSET META_PYTHON_EXE=\"%META_PATH%\\bin\\Python27\\Scripts\\Python.exe\"\n    %META_PYTHON_EXE% execute.py %1\n)\nIF %QUERY_ERRORLEVEL% == 1 (\n    echo on\necho \"META tools not installed.\" >> _FAILED.txt\necho \"See Error Log: _FAILED.txt\"\npopd\nexit /b %QUERY_ERRORLEVEL%\n)\npopd\nexit /b %ERRORLEVEL%\n"
    };
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/AtmExporter/AtmExporter/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/*globals define */
/**
 * Generated by PluginGenerator from webgme on Wed Sep 03 2014 15:36:17 GMT-0500 (Central Daylight Time).
 */

define( 'plugin/AdmExporter/AtmExporter/AtmExporter',[
    'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/AtmExporter/AtmExporter/meta',
    'plugin/AdmExporter/AdmExporter/AdmExporter',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, MetaTypes, AdmExporter, Converter ) {
    

    /**
     * Initializes a new instance of AtmExporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin AtmExporter.
     * @constructor
     */
    var AtmExporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = null;
        this.atmData = null;
        this.admExporter = null;
    };

    // Prototypal inheritance from PluginBase.
    AtmExporter.prototype = Object.create( PluginBase.prototype );
    AtmExporter.prototype.constructor = AtmExporter;

    /**
     * Gets the name of the AtmExporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    AtmExporter.prototype.getName = function () {
        return "ATM Exporter";
    };

    /**
     * Gets the semantic version (semver.org) of the AtmExporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    AtmExporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the AtmExporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    AtmExporter.prototype.getDescription = function () {
        return "Exports an ATM based on the AVMTestBenchModel.";
    };

    /**
     * Gets the configuration structure for the AtmExporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    AtmExporter.prototype.getConfigStructure = function () {
        return [];
    };


    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    AtmExporter.prototype.main = function ( callback ) {
        var self = this;

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }
        if ( self.isMetaTypeOf( self.activeNode, self.META.AVMTestBenchModel ) === false ) {
            self.createMessage( null, 'This plugin must be called from a AVMTestBenchModel.', 'error' );
            callback( null, self.result );
            return;
        }
        self.meta = MetaTypes;
        self.updateMETA( self.meta );
        self.getTlsutInterface( self.activeNode, function ( err, tlsut ) {
            var artifact,
                atmXmlStr,
                jsonToXml = new Converter.Json2xml();
            if ( err ) {
                self.logger.error( 'Error when exploring TestBench, err: ' + err );
                callback( null, self.result );
                return;
            }
            artifact = self.blobClient.createArtifact( 'testBench' );
            atmXmlStr = jsonToXml.convertToString( {
                TestBench: self.atmData
            } );
            artifact.addFile( self.atmData[ '@Name' ] + '.atm', atmXmlStr, function ( err, hash ) {
                if ( err ) {
                    callback( 'Could not add atm file : err' + err.toString(), self.result );
                    return;
                }
                self.logger.info( 'Added atm files to artifact, it has hash: ' + hash );
                artifact.save( function ( err, hash ) {
                    if ( err ) {
                        callback( 'Could not save atm artifact : err' + err.toString(), self.result );
                        return;
                    }
                    self.result.addArtifact( hash );
                    self.result.setSuccess( true );
                    callback( null, self.result );
                } );
            } );
        } );
    };

    AtmExporter.prototype.getTlsutInterface = function ( testBenchNode, callback ) {
        var self = this,
            rootPath = self.core.getPath( testBenchNode ),
            name = self.core.getAttribute( testBenchNode, 'name' );

        self.atmData = {
            "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
            "@Name": name,
            "@xmlns": "avm",
            "TopLevelSystemUnderTest": null,
            "Parameter": [],
            "Metric": [],
            "TestInjectionPoint": [],
            "TestComponent": [],
            "Workflow": null,
            "Settings": [],
            "TestStructure": []
        };

        self.initializeAdmExporter( rootPath );

        self.core.loadChildren( testBenchNode, function ( err, children ) {
            var counter, i,
                error = '',
                metaTypeName,
                counterCallback,
                tlsutData;
            if ( err ) {
                callback( 'loadChildren failed for test-bench "' + name + '" with err:' + err.toString() );
                return;
            }
            counter = children.length;
            counterCallback = function ( err ) {
                error = err ? error + err : error;
                counter -= 1;
                if ( counter <= 0 ) {
                    if ( tlsutData ) {
                        callback( error, tlsutData );
                    } else {
                        callback( error + ' there was no Container in the test-bench "' + name + '".' );
                    }
                }
            };

            if ( children.length === 0 ) {
                self.createMessage( testBenchNode, 'Test-bench "' + name + '" was empty!', 'error' );
                counterCallback( 'Test-bench "' + name + '" was empty!' );
            }

            for ( i = 0; i < children.length; i += 1 ) {
                metaTypeName = self.core.getAttribute( self.getMetaType( children[ i ] ), 'name' );
                if ( metaTypeName === 'Container' ) {
                    if ( tlsutData ) {
                        self.createMessage( testBenchNode, 'There was more than one TLSUT in test-bench "' +
                            name + '".', 'error' );
                        counterCallback( 'There was more than one TLSUT in test-bench "' + name + '".' );
                    } else {
                        self.exploreTlsut( children[ i ], function ( err, retrievedData ) {
                            tlsutData = retrievedData;
                            counterCallback( err );
                        } );
                    }
                } else if ( metaTypeName === 'Workflow' ) {
                    self.addWorkflow( children[ i ], counterCallback );
                } else if ( metaTypeName === 'Metric' ) {
                    self.addMetric( children[ i ], counterCallback );
                } else if ( metaTypeName === 'AVMComponentModel' ) {
                    self.admExporter.addComponentInstance( children[ i ], testBenchNode, self.atmData,
                        counterCallback );
                } else {
                    counterCallback( null );
                }
            }
        } );
    };

    AtmExporter.prototype.exploreTlsut = function ( tlsutNode, callback ) {
        var self = this;
        self.core.loadChildren( tlsutNode, function ( err, children ) {
            var counter, i,
                error = '',
                metaTypeName,
                childName,
                counterCallback,
                tlsutData = {
                    properties: {},
                    connectors: {}
                };
            if ( err ) {
                callback( 'loadChildren failed for tlsut with err:' + err.toString() );
                return;
            }
            counter = children.length;
            counterCallback = function ( err ) {
                error = err ? error + err : error;
                counter -= 1;
                if ( counter <= 0 ) {
                    callback( error, tlsutData );
                }
            };

            if ( children.length === 0 ) {
                counterCallback( null );
            }

            for ( i = 0; i < children.length; i += 1 ) {
                metaTypeName = self.core.getAttribute( self.getMetaType( children[ i ] ), 'name' );
                childName = self.core.getAttribute( children[ i ], 'name' );
                if ( metaTypeName === 'Property' ) {
                    //TODO: Elaborate on the info stored, e.g. units, type etc. For now just use names.
                    if ( tlsutData.properties[ childName ] ) {
                        counterCallback( 'Duplicate name, "' + childName +
                            '"  of properties in top level system under test!' );
                    } else {
                        tlsutData.properties[ childName ] = children[ i ];
                        counterCallback( null );
                    }
                } else if ( metaTypeName === 'Connector' ) {
                    //TODO: Elaborate on the info stored, e.g. domainConnectors, Classes etc.
                    if ( tlsutData.connectors[ childName ] ) {
                        counterCallback( 'Duplicate name, "' + childName +
                            '"  of connectors in top level system under test!' );
                    } else {
                        tlsutData.connectors[ childName ] = children[ i ];
                        counterCallback( null );
                    }
                } else {
                    counterCallback( null );
                }
            }
        } );
    };

    AtmExporter.prototype.addWorkflow = function ( wfNode, callback ) {
        var self = this,
            name = self.core.getAttribute( wfNode, 'name' ),
            wfData = {
                '@Name': name,
                '@xmlns': '',
                'Task': []
            };
        self.atmData.Workflow = wfData;
        self.core.loadChildren( wfNode, function ( err, children ) {
            var counter, i,
                addTask,
                metaTypeName,
                taskData;
            if ( err ) {
                callback( 'loadChildren failed for work-flow with err: ' + err.toString() );
                return;
            }
            counter = children.length;
            addTask = function ( taskNode ) {
                if ( taskNode ) {
                    if ( self.core.getAttribute( taskNode, 'Type' ) === 'InterpreterTask' ) {
                        taskData = {
                            '@xmlns:q1': 'avm',
                            '@xsi:type': 'q1:InterpreterTask',
                            '@Name': self.core.getAttribute( taskNode, 'name' ),
                            '@COMName': self.core.getAttribute( taskNode, 'COMName' ),
                            '@Parameters': self.core.getAttribute( taskNode, 'Parameters' )
                        };
                        wfData.Task.push( taskData );
                    }
                }
                counter -= 1;
                if ( counter <= 0 ) {
                    callback( null );
                }
            };

            if ( children.length === 0 ) {
                self.createMessage( wfNode, 'No task defined in Workflow!', 'error' );
                callback( 'No task defined in workflow' );
            }

            for ( i = 0; i < children.length; i += 1 ) {
                metaTypeName = self.core.getAttribute( self.getMetaType( children[ i ] ), 'name' );
                if ( metaTypeName === 'Task' ) {
                    addTask( children[ i ] );
                } else {
                    addTask( null, null );
                }
            }
        } );

    };

    AtmExporter.prototype.addMetric = function ( metricNode, callback ) {
        var self = this,
            name = self.core.getAttribute( metricNode, 'name' ),
            pos = self.core.getRegistry( metricNode, 'position' );
        self.atmData.Metric.push( {
            '@xmlns': '',
            '@Name': name,
            '@Notes': self.core.getAttribute( metricNode, 'INFO' ),
            "@XPosition": Math.floor( pos.x ),
            "@YPosition": Math.floor( pos.y ),
            "Value": null
        } );
        callback( null );
    };

    AtmExporter.prototype.initializeAdmExporter = function ( rootPath ) {
        var self = this;
        self.admExporter = new AdmExporter();
        self.admExporter.meta = self.meta;
        self.admExporter.META = self.META;
        self.admExporter.core = self.core;
        self.admExporter.logger = self.logger;
        self.admExporter.result = self.result;
        self.admExporter.rootPath = rootPath;
        // TODO: delete next line when ATM-flow is more mature.
        self.admExporter.includeAcms = false;
        self.logger.info( 'AdmExporter initialized.' );
    };

    return AtmExporter;
} );
//noinspection JSLint
/**
 * Generated by PluginGenerator from webgme on Thu May 22 2014 22:27:57 GMT-0500 (Central Daylight Time).
 */

define( 'plugin/TestBenchRunner/TestBenchRunner/TestBenchRunner',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/TestBenchRunner/TestBenchRunner/meta',
    'plugin/TestBenchRunner/TestBenchRunner/Templates/Templates',
    'plugin/AdmExporter/AdmExporter/AdmExporter',
    'plugin/AdmExporter/AtmExporter/AtmExporter',
    'xmljsonconverter',
    'executor/ExecutorClient',
    'ejs'
], function ( PluginConfig, PluginBase, MetaTypes, TEMPLATES, AdmExporter, AtmExporter, Converter, ExecutorClient,
    ejs ) {
    
    //<editor-fold desc="============================ Class Definition ================================">
    /**
     * Initializes a new instance of TestBenchRunner.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin TestBenchRunner.
     * @constructor
     */
    var TestBenchRunner = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = MetaTypes;
        this.referencedDesign = null;
        this.saveToModel = false;
        this.resultsData = {};
        // Execution frame-work.
        this.runExecution = false;
        this.run_exec_cmd = null;
        this.exec_py = null;
        this.executorClient = null;
        // AVM design format
        this.designAcmFiles = null;
        this.admData = null;
        this.admString = null;

        this.admExporter = null;
        this.atmExporter = null;
    };

    // Prototypal inheritance from PluginBase.
    TestBenchRunner.prototype = Object.create( PluginBase.prototype );
    TestBenchRunner.prototype.constructor = TestBenchRunner;

    /**
     * Gets the name of the TestBenchRunner.
     * @returns {string} The name of the plugin.
     * @public
     */
    TestBenchRunner.prototype.getName = function () {
        return "Test bench runner";
    };

    /**
     * Gets the semantic version (semver.org) of the TestBenchRunner.
     * @returns {string} The version of the plugin.
     * @public
     */
    TestBenchRunner.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the TestBenchRunner.
     * @returns {string} The description of the plugin.
     * @public
     */
    TestBenchRunner.prototype.getDescription = function () {
        return "Exports the design and run the test-bench from where it is called.";
    };

    /**
     * Gets the configuration structure for the TestBenchRunner.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    TestBenchRunner.prototype.getConfigStructure = function () {
        return [ {
            'name': 'run',
            'displayName': 'Run test-bench',
            'description': 'Will start a job and run the test-bench.',
            'value': false,
            'valueType': 'boolean',
            'readOnly': false
        }, {
            'name': 'save',
            'displayName': 'Save results',
            'description': 'Will save the results back to the model (only applicable when run is selected).',
            'value': false,
            'valueType': 'boolean',
            'readOnly': false
        }, {
            'name': 'configurationPath',
            'displayName': 'DesertConfigurationID',
            'description': 'ID of DesertConfiguration object inside referenced TopLevelSystemUnderTest.',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        } ];
    };
    //</editor-fold>

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    TestBenchRunner.prototype.main = function ( callback ) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            currentConfig = self.getCurrentConfig();

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }
        if ( self.isMetaTypeOf( self.activeNode, self.META.AVMTestBenchModel ) === false ) {
            self.createMessage( null, 'This plugin must be called from an AVMTestBenchModel.', 'error' );
            callback( null, self.result );
            return;
        }
        self.updateMETA( self.meta );
        self.runExecution = currentConfig.run;
        self.saveToModel = currentConfig.save;
        self.cfgPath = currentConfig.configurationPath;

        self.getTestBenchInfo( self.activeNode, function ( err, testBenchInfo ) {
            if ( err ) {
                self.logger.error( 'getTestBenchInfo returned with error: ' + err.toString() );
                self.createMessage( self.activeNode, 'Something went wrong when exploring the test-bench.',
                    'error' );
                callback( null, self.result );
                return;
            }
            self.getAdmAndAcms( self.referencedDesign, [ testBenchInfo ], function ( err ) {
                if ( err ) {
                    self.logger.error( err );
                    self.createMessage( self.referencedDesign,
                        'Something went wrong when exploring the referenced design.', 'error' );
                    callback( null, self.result );
                    return;
                }
                self.generateExecutionFiles( testBenchInfo, function ( err, artifact ) {
                    if ( err ) {
                        callback( 'Could generateExecutionFiles : err' + err.toString(), self.result );
                        return;
                    }
                    artifact.save( function ( err, hash ) {
                        if ( err ) {
                            callback( 'Could not save artifact : err' + err.toString(), self.result );
                            return;
                        }
                        self.result.addArtifact( hash );
                        if ( self.runExecution ) {
                            self.executeJob( hash, testBenchInfo, function ( err, success ) {
                                if ( err ) {
                                    self.logger.error( err );
                                    callback( err, self.result );
                                    return;
                                }
                                self.result.setSuccess( success );
                                if ( self.saveToModel && self.cfgPath ) {
                                    self.loadLatestRoot( function ( err, latestRootNode ) {
                                        if ( err ) {
                                            self.logger.error( err );
                                            callback( err, self.result );
                                            return;
                                        }
                                        self.core.loadByPath( latestRootNode, self.resultsData
                                            .configurationPath, function ( err, cfgNode ) {
                                                var resultNode;
                                                if ( err ) {
                                                    self.logger.error( err );
                                                    callback( err, self.result );
                                                    return;
                                                }
                                                self.core.loadByPath( latestRootNode, self.resultsData
                                                    .resultMetaNodePath, function ( err,
                                                        resMetaNode ) {
                                                        if ( err ) {
                                                            self.logger.error( err );
                                                            callback( err, self.result );
                                                            return;
                                                        }

                                                        self.core.loadByPath(
                                                            latestRootNode, self.resultsData
                                                            .executedTestBenchPath,
                                                            function ( err, tbNode ) {
                                                                if ( err ) {
                                                                    self.logger.error( err );
                                                                    callback( err, self.result );
                                                                    return;
                                                                }
                                                                resultNode = self.core.createNode( {
                                                                    parent: cfgNode,
                                                                    base: resMetaNode
                                                                } );
                                                                self.core.setAttribute(
                                                                    resultNode, 'name', new Date()
                                                                    .toString() );
                                                                self.core.setAttribute(
                                                                    resultNode, 'CfgAdm',
                                                                    self.resultsData.cfgAdm
                                                                );
                                                                self.core.setPointer(
                                                                    resultNode,
                                                                    'ExecutedTestBench',
                                                                    tbNode );
                                                                self.core.setAttribute(
                                                                    resultNode,
                                                                    'TestBenchManifest',
                                                                    'See Artifacts...' );
                                                                self.core.setAttribute(
                                                                    resultNode, 'Artifacts',
                                                                    self.resultsData.testBenchManifest
                                                                );
                                                                self.logger.info(
                                                                    'Execution succeeded for test-bench "' +
                                                                    testBenchInfo.name +
                                                                    '".' );
                                                                self.save( 'Test-bench "' +
                                                                    testBenchInfo.name +
                                                                    '" results was updated after execution.',
                                                                    function ( err ) {
                                                                        if ( err ) {
                                                                            self.result.setSuccess(
                                                                                false );
                                                                            callback( err,
                                                                                self.result
                                                                            );
                                                                        }
                                                                        self.createMessage(
                                                                            resultNode,
                                                                            'Results saved to result node.',
                                                                            'info' );
                                                                        callback( null,
                                                                            self.result );
                                                                    } );
                                                            } );
                                                    } );
                                            } );
                                    } );
                                } else if ( self.saveToModel && success ) {
                                    self.save( 'Test-bench "' + testBenchInfo.name +
                                        '" results was updated after execution.', function (
                                            err ) {
                                            if ( err ) {
                                                self.result.setSuccess( false );
                                                callback( err, self.result );
                                            }
                                            self.createMessage( null,
                                                'Results saved to test-bench node.', 'info' );
                                            callback( null, self.result );
                                        } );
                                } else {
                                    callback( null, self.result );
                                }
                            } );
                        } else {
                            self.result.setSuccess( true );
                            callback( null, self.result );
                        }
                    } );
                } );
            } );
        } );
    };

    TestBenchRunner.prototype.getTestBenchInfo = function ( testBenchNode, callback ) {
        var self = this,
            testBenchInfo = {};
        testBenchInfo.name = self.core.getAttribute( testBenchNode, 'name' );
        testBenchInfo.path = self.core.getAttribute( testBenchNode, 'ID' );
        testBenchInfo.testBenchFilesHash = self.core.getAttribute( testBenchNode, 'TestBenchFiles' );
        testBenchInfo.node = testBenchNode;
        if ( !testBenchInfo.path ) {
            self.createMessage( testBenchNode, 'There is no "ID" provided for the test-bench. It must be a path' +
                ' in the project-tree of the xme in asset "TestBenchFiles", e.g. /TestBenches/Dynamics/MyTestBench',
                'error' );
            callback( 'TestBench ID not provided.' );
            return;
        }
        self.logger.info( 'Getting data for test-bench "' + testBenchInfo.name + '".' );
        self.initializeAtmExporter();
        self.atmExporter.getTlsutInterface( testBenchNode, function ( err, tlsut ) {
            if ( err ) {
                self.createMessage( testBenchNode, 'Could not obtain Top Level System Under test interface.',
                    'error' );
                callback( 'Something went wrong when getting tlsut interface err: ' + err );
                return;
            }
            testBenchInfo.tlsut = tlsut;

            // For single test-benches check the reference for the test-bench and its parent folder.
            if ( self.core.hasPointer( testBenchNode, 'TopLevelSystemUnderTest' ) ) {
                self.logger.info( 'Test-bench has TopLevelSystemUnderTest ref set.' );
                self.core.loadPointer( testBenchNode, 'TopLevelSystemUnderTest', function ( err, design ) {
                    if ( err ) {
                        self.logger.error( 'loading TLSUT failed with err: ' + err.toString() );
                        callback( err );
                        return;
                    }
                    self.referencedDesign = design;
                    callback( null, testBenchInfo );
                } );
            } else {
                self.createMessage( testBenchNode, 'No TopLevelSystemUnderTest reference set for test-bench.',
                    'error' );
                callback( 'Found no reference to TLSUT.' );
            }
        } );
    };

    TestBenchRunner.prototype.getAdmAndAcms = function ( designNode, testBenchInfos, callback ) {
        var self = this;
        self.checkDesignAgainstTLSUTs( designNode, testBenchInfos, function ( err, result ) {
            if ( err ) {
                callback( err );
                return;
            }
            if ( result !== true ) {
                self.createMessage( designNode, 'Design did not match TopLevelSystemUnderTests!', 'error' );
                callback( 'Design did not match TopLevelSystemUnderTests!' );
                return;
            }
            self.initializeAdmExporter();
            self.admExporter.rootPath = self.core.getPath( designNode );
            self.admExporter.setupDesertCfg( self.cfgPath, function ( err ) {
                if ( err ) {
                    callback( 'Failed setting up desertConfigurations, err: ' + err );
                    return;
                }
                if ( self.admExporter.selectedAlternatives ) {
                    self.logger.info( 'Running on single configuration' );
                    self.logger.info( JSON.stringify( self.admExporter.selectedAlternatives, null ) );
                }
                self.admExporter.exploreDesign( designNode, true, function ( err ) {
                    if ( err ) {
                        callback( 'AdmExporter.exploreDesign failed with error: ' + err );
                        return;
                    }
                    self.admData = self.admExporter.admData;
                    self.designAcmFiles = self.admExporter.acmFiles;
                    callback( null );
                } );
            } );
        } );
    };

    TestBenchRunner.prototype.checkDesignAgainstTLSUTs = function ( designNode, testBenchInfos, callback ) {
        var self = this,
            k,
            key,
            mergedProperties = {},
            mergedConnectors = {};
        for ( k = 0; k < testBenchInfos.length; k += 1 ) {
            for ( key in testBenchInfos[ k ].tlsut.properties ) {
                if ( testBenchInfos[ k ].tlsut.properties.hasOwnProperty( key ) ) {
                    mergedProperties[ key ] = testBenchInfos[ k ].tlsut.properties[ key ];
                }
            }
            for ( key in testBenchInfos[ k ].tlsut.connectors ) {
                if ( testBenchInfos[ k ].tlsut.connectors.hasOwnProperty( key ) ) {
                    mergedConnectors[ key ] = testBenchInfos[ k ].tlsut.connectors[ key ];
                }
            }
        }

        self.core.loadChildren( designNode, function ( err, children ) {
            var counter, i,
                error = '',
                metaTypeName,
                childName,
                counterCallback;
            if ( err ) {
                callback( 'loadChildren failed for tlsut with err:' + err.toString() );
                return;
            }
            counter = children.length;
            counterCallback = function ( err ) {
                var innerKey,
                    isValid;

                error = err ? error + err : error;
                counter -= 1;
                if ( counter <= 0 ) {
                    isValid = true;
                    for ( innerKey in mergedProperties ) {
                        if ( mergedProperties.hasOwnProperty( innerKey ) && mergedProperties[ innerKey ] !==
                            true ) {
                            //isValid = false;
                            self.createMessage( mergedProperties[ innerKey ], 'Design does not have property "' +
                                innerKey + '". Property checks are currently ignored.', 'warning' );
                        }
                    }
                    for ( innerKey in mergedConnectors ) {
                        if ( mergedConnectors.hasOwnProperty( innerKey ) && mergedConnectors[ innerKey ] !==
                            true ) {
                            isValid = false;
                            self.createMessage( mergedConnectors[ innerKey ],
                                'Design does not have connector "' +
                                innerKey + '".', 'error' );
                        }
                    }
                    callback( error, isValid );
                }
            };

            if ( children.length === 0 ) {
                counterCallback( null );
            }

            for ( i = 0; i < children.length; i += 1 ) {
                metaTypeName = self.core.getAttribute( self.getMetaType( children[ i ] ), 'name' );
                childName = self.core.getAttribute( children[ i ], 'name' );
                if ( metaTypeName === 'Property' ) {
                    if ( mergedProperties[ childName ] !== undefined ) {
                        mergedProperties[ childName ] = true;
                    }
                    counterCallback( null );
                } else if ( metaTypeName === 'Connector' ) {
                    if ( mergedConnectors[ childName ] !== undefined ) {
                        mergedConnectors[ childName ] = true;
                    }
                    counterCallback( null );
                } else {
                    counterCallback( null );
                }
            }
        } );
    };

    TestBenchRunner.prototype.initializeAdmExporter = function () {
        var self = this;
        if ( self.admExporter === null ) {
            self.admExporter = new AdmExporter();
            self.admExporter.meta = self.meta;
            self.admExporter.META = self.META;
            self.admExporter.core = self.core;
            self.admExporter.logger = self.logger;
            self.admExporter.result = self.result;
            self.admExporter.rootNode = self.rootNode;
            self.logger.info( 'AdmExporter had not been initialized - created a new instance.' );
        } else {
            self.admExporter.acmFiles = {};
            self.admExporter.gatheredAcms = {};
            self.admExporter.rootPath = null;
            self.admExporter.includeAcms = true;
            self.logger.info(
                'AdmExporter had already been initialized - reset acmFiles, gatheredAcms and rootPath.' );
        }
    };

    TestBenchRunner.prototype.initializeAtmExporter = function () {
        var self = this;
        self.atmExporter = new AtmExporter();
        self.atmExporter.meta = self.meta;
        self.atmExporter.META = self.META;
        self.atmExporter.core = self.core;
        self.atmExporter.logger = self.logger;
        self.atmExporter.result = self.result;
        self.atmExporter.atmData = null;
        self.logger.info( 'AtmExporter initialized.' );
    };

    TestBenchRunner.prototype.generateExecutionFiles = function ( testBenchInfo, callback ) {
        var self = this,
            artifact,
            executorConfig,
            jsonToXml,
            testbenchConfig,
            filesToAdd = {};
        self.logger.info( 'Generating execution files.' );
        if ( !self.admString ) {
            // Only convert the common ejs files once.
            self.logger.info( 'This was first generation of common filesToAdd.' );
            jsonToXml = new Converter.Json2xml();
            self.admString = jsonToXml.convertToString( {
                Design: self.admData
            } );
            self.run_exec_cmd = ejs.render( TEMPLATES[ 'run_execution.cmd.ejs' ] );
            self.exec_py = ejs.render( TEMPLATES[ 'execute.py.ejs' ] );
        }
        filesToAdd[ self.admData[ '@Name' ] + '.adm' ] = self.admString;
        filesToAdd[ 'run_execution.cmd' ] = self.run_exec_cmd;
        filesToAdd[ 'execute.py' ] = self.exec_py;
        executorConfig = JSON.stringify( {
            cmd: 'run_execution.cmd',
            resultArtifacts: [ {
                name: 'dashboard',
                resultPatterns: [ 'dashboard/**', 'designs/**', 'design-space/**', 'requirements/**',
                    'test-benches/**', 'results/*/testbench_manifest.json',
                    'results/results.metaresults.json',
                    'manifest.project.json', 'index.html', '*.svg'
                ]
            }, {
                name: 'logs',
                resultPatterns: [ 'log/**', '_FAILED.txt' ]
            }, {
                name: 'all',
                resultPatterns: []
            }, {
                name: 'testBenchManifest',
                resultPatterns: [ 'results/*/testbench_manifest.json' ]
            }, {
                name: 'cfgAdm',
                resultPatterns: [ 'designs/**' ]
            } ]

        }, null, 4 );
        filesToAdd[ 'executor_config.json' ] = executorConfig;
        testbenchConfig = JSON.stringify( {
            name: testBenchInfo.name,
            path: testBenchInfo.path
        }, null, 4 );
        filesToAdd[ 'testbench_config.json' ] = testbenchConfig;
        self.logger.info( 'TestBenchConfig : ' + testbenchConfig );
        self.logger.info( 'ExecutorConfig  : ' + executorConfig );

        artifact = self.blobClient.createArtifact( testBenchInfo.name );
        artifact.addMetadataHash( 'tbAsset.zip', testBenchInfo.testBenchFilesHash, function ( err, hash ) {
            if ( err ) {
                callback( 'Could not add tbAsset.zip from test-bench : err' + err.toString() );
                return;
            }
            artifact.addObjectHashes( self.designAcmFiles, function ( err, hashes ) {
                if ( err ) {
                    callback( 'Could not add acm files : err' + err.toString() );
                    return;
                }
                artifact.addFiles( filesToAdd, function ( err, hashes ) {
                    if ( err ) {
                        callback( 'Could not add script files : err' + err.toString() );
                        return;
                    }
                    callback( null, artifact );
                } );
            } );
        } );
    };

    TestBenchRunner.prototype.executeJob = function ( artifactHash, testBenchInfo, callback ) {
        var self = this;

        if ( !self.executorClient ) {
            self.logger.info( 'First execution, creating executor client..' );
            self.executorClient = new ExecutorClient();
        }
        self.executorClient.createJob( artifactHash, function ( err, jobInfo ) {
            var intervalID,
                atSucceedJob;
            if ( err ) {
                callback( 'Creating job failed for "' + testBenchInfo.name + '", err: ' + err.toString(), false );
                return;
            }
            self.logger.info( 'Initial job-info:' + JSON.stringify( jobInfo, null, 4 ) );

            atSucceedJob = function ( jInfo ) {
                var key;
                self.logger.info( 'Execution for test-bench "' + testBenchInfo.name + '"  succeeded.' );
                self.logger.info( 'Its final JobInfo looks like : ' + JSON.stringify( jInfo, null, 4 ) );
                for ( key in jInfo.resultHashes ) {
                    if ( jInfo.resultHashes.hasOwnProperty( key ) ) {
                        self.result.addArtifact( jInfo.resultHashes[ key ] );
                    }
                }
                self.blobClient.getMetadata( jInfo.resultHashes.logs, function ( err, metadata ) {
                    if ( err ) {
                        callback( 'Could not get metadata for result. Err: ' + err, false );
                        return;
                    }
                    if ( metadata.content.hasOwnProperty( '_FAILED.txt' ) ) {
                        self.createMessage( testBenchInfo.node,
                            'Execution had errors - download execution_results for "' +
                            testBenchInfo.name + '" and read _FAILED.txt', 'error' );
                        callback( null, false );
                        return;
                    }
                    self.core.setAttribute( testBenchInfo.node, 'Results', jInfo.resultHashes.dashboard );
                    // Save data that is needed for storing data result node.
                    self.resultsData = {
                        cfgAdm: jInfo.resultHashes.cfgAdm,
                        executedTestBenchPath: self.core.getPath( testBenchInfo.node ),
                        testBenchManifest: jInfo.resultHashes.testBenchManifest,
                        resultMetaNodePath: self.core.getPath( self.meta.Result ),
                        configurationPath: self.cfgPath
                    };
                    self.logger.info( 'Execution succeeded for test-bench "' + testBenchInfo.name + '".' );
                    callback( null, true );
                } );
            };

            //noinspection JSLint
            intervalID = setInterval( function () {
                // Get the job-info at intervals and check for a non-CREATED status.
                self.executorClient.getInfo( artifactHash, function ( err, jInfo ) {
                    self.logger.info( JSON.stringify( jInfo, null, 4 ) );
                    if ( jInfo.status === 'CREATED' || jInfo.status === 'RUNNING' ) {
                        // The job is still running..
                        return;
                    }
                    //noinspection JSLint
                    clearInterval( intervalID );
                    if ( jInfo.status === 'SUCCESS' ) {
                        atSucceedJob( jInfo );
                    } else {
                        self.result.addArtifact( jInfo.resultHashes[ testBenchInfo.name + '_logs' ] );
                        self.result.addArtifact( jInfo.resultHashes[ testBenchInfo.name + '_all' ] );
                        callback( 'Job execution failed', false );
                    }
                } );
            }, 2000 );
        } );
    };

    TestBenchRunner.prototype.endsWith = function ( str, ending ) {
        var lastIndex = str.lastIndexOf( ending );
        return ( lastIndex !== -1 ) && ( lastIndex + ending.length === str.length );
    };

    TestBenchRunner.prototype.loadLatestRoot = function ( callback ) {
        var self = this;
        if ( self.branchName ) {
            self.project.getBranchNames( function ( err, branchNames ) {
                var branchHash;
                if ( err ) {
                    callback( err );
                    return;
                }
                if ( branchNames.hasOwnProperty( self.branchName ) ) {
                    branchHash = branchNames[ self.branchName ];
                    if ( branchHash === self.branchHash ) {
                        // The branch does not have any new commits - return with original rootNode.
                        self.logger.info( 'Branch did not change during execution..' );
                        callback( null, self.rootNode );
                    } else {
                        // There were commits to the branch since the plugin started.
                        self.logger.info( 'Loading latest commit, from ' + self.branchHash );
                        self.project.getBranchHash( self.branchName, self.branchHash, function ( err,
                            latestHash ) {
                            if ( err ) {
                                self.logger.error( err );
                                callback( err );
                                return;
                            }
                            self.logger.info( 'Obtained latest commit hash for "' + self.branchName + '": ' +
                                latestHash +
                                '. Attempting to load commit..' );
                            self.project.loadObject( latestHash, function ( err, commitObj ) {
                                if ( err ) {
                                    callback( err );
                                    return;
                                }
                                self.core.loadRoot( commitObj.root, function ( err, latestRoot ) {
                                    if ( err ) {
                                        callback( err );
                                        return;
                                    }
                                    self.branchHash = branchHash;
                                    self.rootNode = latestRoot;
                                    callback( null, latestRoot );
                                } );
                            } );
                        } );
                    }
                } else {
                    callback( null, self.rootNode );
                }
            } );
        } else {
            callback( null, self.rootNode );
        }
    };

    return TestBenchRunner;
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/ExportWorkspace/ExportWorkspace/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/* global define,require */
/* Generated file based on ejs templates */
define( 'plugin/ExportWorkspace/ExportWorkspace/Templates/Templates',[], function () {
    return {
        "workspace.xme.ejs": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE project SYSTEM \"mga.dtd\">\n\n<project guid=\"{13ABCA2C-6976-4585-BD00-E7A0D848FC39}\" cdate=\"Thu Jul 17 10:16:59 2014\" mdate=\"Thu Jul 17 10:16:59 2014\" version=\"\" metaguid=\"{5724B9A1-EFED-46B2-83B6-205745BFC5FE}\" metaversion=\"$Rev: 27234 $\" metaname=\"CyPhyML\">\n    <name>RootFolder</name>\n    <comment></comment>\n    <author></author>\n    <folder id=\"id-006a-00000001\" relid=\"0x1\" childrelidcntr=\"0x4\" kind=\"RootFolder\" guid=\"{5bd6859e-5be3-40f4-bf8d-bf844760b7cd}\">\n        <name>RootFolder</name>\n    </folder>\n</project>"
    };
} );
/*globals define*/
/**
 * Generated by PluginGenerator from webgme on Thu Jul 17 2014 10:06:34 GMT-0500 (Central Daylight Time).
 */

define( 'plugin/ExportWorkspace/ExportWorkspace/ExportWorkspace',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/ExportWorkspace/ExportWorkspace/meta',
    'plugin/ExportWorkspace/ExportWorkspace/Templates/Templates',
    'plugin/AdmExporter/AdmExporter/AdmExporter',
    'xmljsonconverter',
    'ejs'
], function ( PluginConfig, PluginBase, MetaTypes, TEMPLATES, AdmExporter, Converter, ejs ) {
    

    /**
     * Initializes a new instance of ExportWorkspace.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin ExportWorkspace.
     * @constructor
     */
    var ExportWorkspace = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = null;
        this.admExporter = null;
        this.artifact = null;
        this.addedAdms = {};
        this.designNodes = [];
    };

    // Prototypal inheritance from PluginBase.
    ExportWorkspace.prototype = Object.create( PluginBase.prototype );
    ExportWorkspace.prototype.constructor = ExportWorkspace;

    /**
     * Gets the name of the ExportWorkspace.
     * @returns {string} The name of the plugin.
     * @public
     */
    ExportWorkspace.prototype.getName = function () {
        return "Export Workspace";
    };

    /**
     * Gets the semantic version (semver.org) of the ExportWorkspace.
     * @returns {string} The version of the plugin.
     * @public
     */
    ExportWorkspace.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the ExportWorkspace.
     * @returns {string} The description of the plugin.
     * @public
     */
    ExportWorkspace.prototype.getDescription = function () {
        return "Exports everything in the work-space for desktop gme.";
    };

    /**
     * Gets the configuration structure for the ExportWorkspace.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    ExportWorkspace.prototype.getConfigStructure = function () {
        return [];
    };


    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    ExportWorkspace.prototype.main = function ( callback ) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this;
        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }
        if ( self.isMetaTypeOf( self.activeNode, self.META.WorkSpace ) === false ) {
            self.createMessage( null, 'This plugin must be called from a WorkSpace.', 'error' );
            callback( null, self.result );
            return;
        }

        self.meta = MetaTypes;
        self.updateMETA( self.meta );
        self.artifact = self.blobClient.createArtifact( 'workspace' );
        self.visitAllChildrenFromWorkspace( self.activeNode, function ( err ) {
            if ( err ) {
                self.result.setSuccess( false );
                self.logger.error( err );
                callback( null, self.result );
                return;
            }
            self.exportAdms( function ( err ) {
                if ( err ) {
                    self.result.setSuccess( false );
                    self.logger.error( err );
                    callback( null, self.result );
                    return;
                }
                self.artifact.addFile( 'workspace.xme', ejs.render( TEMPLATES[ 'workspace.xme.ejs' ] ),
                    function ( err, hash ) {
                        if ( err ) {
                            self.result.setSuccess( false );
                            self.createMessage( null, 'Could not add workspace.xme to artifact.', 'error' );
                            callback( null, self.result );
                            return;
                        }
                        self.artifact.save( function ( err, hash ) {
                            if ( err ) {
                                self.result.setSuccess( false );
                                callback( err, self.result );
                                return;
                            }
                            self.result.addArtifact( hash );
                            self.result.setSuccess( true );
                            callback( null, self.result );
                        } );
                    } );
            } );
        } );
    };

    ExportWorkspace.prototype.addAcm = function ( node, callback ) {
        var self = this,
            acmHash = self.core.getAttribute( node, 'Resource' ),
            componentID = self.core.getAttribute( node, 'ID' ),
            name = self.core.getAttribute( node, 'name' ),
            filename = 'acms/' + name + '__' + componentID.replace( /[^\w]/gi, '_' ) + '.zip';
        if ( acmHash ) {
            self.artifact.addObjectHash( filename, acmHash, function ( err, hash ) {
                if ( err ) {
                    callback( err );
                    return;
                }
                callback( null );
            } );
        } else {
            self.logger.warning( 'Acm did not have a resource' );
        }
    };

    ExportWorkspace.prototype.addAdm = function ( node, callback ) {
        var self = this;
        self.designNodes.push( node );
        callback( null );
    };

    ExportWorkspace.prototype.exportAdms = function ( callback ) {
        var self = this,
            error = '',
            counter = self.designNodes.length,
            exportAdm = function () {
                counter -= 1;
                if ( counter < 0 ) {
                    callback( error );
                    return;
                }
                self.initializeAdmExporter();
                self.admExporter.exploreDesign( self.designNodes[ counter ], false, function ( err ) {
                    var jsonToXml = new Converter.Json2xml(),
                        designName,
                        filename,
                        admString;
                    if ( err ) {
                        error += 'AdmExporter.exploreDesign failed with error: ' + err;
                        exportAdm();
                        return;
                    }
                    designName = self.admExporter.admData[ '@Name' ];
                    filename = 'adms/' + designName + '.adm';
                    admString = jsonToXml.convertToString( {
                        Design: self.admExporter.admData
                    } );
                    if ( self.addedAdms[ filename ] ) {
                        self.logger.warning( designName +
                            ' occurs more than once, appending its guid to filename.' );
                        filename = 'adms/' + designName + '__' +
                            self.core.getGuid( self.designNodes[ counter ] )
                            .replace( /[^\w]/gi, '_' ) + '.adm';
                    }
                    self.addedAdms[ filename ] = true;
                    self.artifact.addFile( filename, admString, function ( err, hash ) {
                        if ( err ) {
                            error += 'Saving adm failed: ' + err;
                        }
                        exportAdm();
                    } );
                } );
            };
        exportAdm();
    };

    ExportWorkspace.prototype.addAtm = function ( node, callback ) {
        var self = this;
        self.logger.warning( 'TODO: Export ATMs...' );
        callback( null );
    };

    ExportWorkspace.prototype.atModelNode = function ( node, parent, callback ) {
        var self = this,
            nodeType = self.core.getAttribute( self.getMetaType( node ), 'name' ),
            nodeName = self.core.getAttribute( node, 'name' ),
            parentName = self.core.getAttribute( parent, 'name' );

        self.logger.info( 'At node "' + nodeName + '" of type "' + nodeType + '" with parent "' + parentName + '".' );

        if ( nodeType === 'AVMComponentModel' ) {
            self.addAcm( node, callback );
        } else if ( nodeType === 'Container' ) {
            self.addAdm( node, callback );
        } else if ( nodeType === 'AVMTestBenchModel' ) {
            self.addAtm( node, callback );
        } else if ( nodeType === 'ACMFolder' || nodeType === 'ADMFolder' || nodeType === 'ATMFolder' ) {
            callback( null, true );
        } else {
            callback( null );
        }
    };

    ExportWorkspace.prototype.visitAllChildrenFromWorkspace = function ( wsNode, callback ) {
        var self = this,
            error = '',
            counter,
            counterCallback;

        counter = {
            visits: 1
        };
        counterCallback = function ( err ) {
            error = err ? error + err : error;
            counter.visits -= 1;
            if ( counter.visits === 0 ) {
                callback( error );
            }
        };

        self.visitAllChildrenRec( wsNode, counter, counterCallback );
    };

    ExportWorkspace.prototype.visitAllChildrenRec = function ( node, counter, callback ) {
        var self = this;
        self.core.loadChildren( node, function ( err, children ) {
            var i,
                atModelNodeCallback;
            if ( err ) {
                callback( 'loadChildren failed for ' + self.core.getAttribute( node, 'name' ) );
                return;
            }
            counter.visits += children.length;
            if ( children.length === 0 ) {
                callback( null );
            } else {
                counter.visits -= 1;
                atModelNodeCallback = function ( childNode ) {
                    return function ( err, isFolder ) {
                        if ( err ) {
                            callback( err );
                        }

                        if ( isFolder ) {
                            self.visitAllChildrenRec( childNode, counter, callback );
                        } else {
                            callback( null );
                        }
                    };
                };
                for ( i = 0; i < children.length; i += 1 ) {
                    self.atModelNode( children[ i ], node, atModelNodeCallback( children[ i ] ) );
                }
            }
        } );
    };

    ExportWorkspace.prototype.initializeAdmExporter = function () {
        var self = this;
        if ( self.admExporter === null ) {
            self.admExporter = new AdmExporter();
            self.admExporter.meta = self.meta;
            self.admExporter.META = self.META;
            self.admExporter.core = self.core;
            self.admExporter.logger = self.logger;
            self.admExporter.result = self.result;
            self.admExporter.rootNode = self.rootNode;
            self.logger.info( 'AdmExporter had not been initialized - created a new instance.' );
        } else {
            self.admExporter.rootPath = null;
            self.admExporter.includeAcms = false;
            self.logger.info( 'AdmExporter had already been initialized - reset rootPath.' );
        }
    };

    return ExportWorkspace;
} );
/* global define,require */
/* Generated file based on ejs templates */
define( 'plugin/GenerateDashboard/GenerateDashboard/Templates/Templates',[], function () {
    return {
        "index.html.ejs": "<!DOCTYPE html>\n<html>\n<head>\n    <title>Offline Dashboard - RollingWheel</title>\n    <script type=\"text/javascript\" src=\"./dashboard/inc/jquery.min.js\"></script>\n    <script type=\"text/javascript\" src=\"./dashboard/inc/jquery-ui.min.js\"></script>\n\n    <link rel=\"stylesheet\"\n          type=\"text/css\"\n          href=\"./dashboard/_local/embedder/vf_visualizer_embedder.css\"\n\t>\n    <link rel=\"stylesheet\"\n          type=\"text/css\"\n          href=\"./dashboard/inc/bootstrap/css/bootstrap.css\"\n\t>\n\t\t<script type=\"text/javascript\">\n        $(document).ready(function () {\n\n            var visualizerContainerE = $('#visualizerContainer');\n            lessHeight = $('#visualizerToolbar').outerHeight()+$('#visualizerFooter').outerHeight()+2;\n\n            visualizerContainerE.height($(window).height() - lessHeight);\n\n            $(window).resize(function() {\n                visualizerContainerE.height($(window).height() - lessHeight);\n            });\n\n        });\n    </script>\n\n</head>\n<body style=\"background-color: black;\">\n<div class=\"visualizerToolbar\" id=\"visualizerToolbar\">\n    <a href=\"https://www.vehicleforge.net\" target=\"_blank\" id=\"vfLink\" title=\"Vehicle Forge\"></a>\n</div>\n<iframe src=\"./dashboard/index.html?resource_url=../manifest.project.json\" class=\"visualizerContainer\" id=\"visualizerContainer\"></iframe>\n<div class=\"visualizerFooter\" id=\"visualizerFooter\">\n    <div class=\"srepLocation\">Source: [%%Location of the resource%%]</div>\n</div>\n</body>\n</html>\n\n\n",
        "launch_SimpleHTTPServer.cmd.ejs": ":: Use System Python to start a SimpleHTTPServer\necho off\nif exist \"C:\\Python27\\python.exe\" (\n\"C:\\Python27\\python.exe\" -m SimpleHTTPServer\nexit /b %ERRORLEVEL%\n) else (\necho ERROR: \"C:\\Python27\\python.exe\" does not exist.\npause\n)"
    };
} );
/**
 * Generated by PluginGenerator from webgme on Mon Nov 03 2014 15:50:38 GMT-0600 (Central Standard Time).
 */

define( 'plugin/GenerateDashboard/GenerateDashboard/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/**
 * Created by J on 11/6/2014.
 */

define( 'plugin/GenerateDashboard/GenerateDashboard/dashboardTypes',[], function () {
    

    function manifestProjectJson( cyPhyProjectName ) {
        return {
            Project: {
                Components: [],
                DesignSpaceModels: [],
                Configurations: [],
                TestBenches: [],
                Results: {
                    UrlHints: [
                        "./results/results.metaresults.json"
                    ]
                },
                Requirements: {
                    UrlHints: [
                        "./requirements/requirements.json"
                    ],
                    id: "",
                    vfLink: "",
                    text: ""
                },
                CyPhyProjectFileName: cyPhyProjectName || "None provided",
                LastModified: "2014-11-5"
            }
        };
    }

    function resultsMetaresultsJson() {
        return {
            Results: []
        };
    }

    function resultMetaresult( designID, testbenchName, timeStamp, summaryPath ) {
        return {
            "Design": null,
            "DesignID": '{' + designID + '}' || "{aaabbbccc111222333}",
            "TestBench": testbenchName + ".testbench.json" || "some testbench",
            "Time": timeStamp,
            "Summary": "./" + summaryPath + "/testbench_manifest.json" ||
                "random dir name / testbench manifest destiny"
        };
    }

    function testbenchJson( name ) {
        return {
            $id: "1",
            Name: name || "SinusInput",
            Metrics: [],
            Parameters: [],
            Requirements: []
        };
    }

    function testbenchMetric( name, value, unit, id ) {
        return {
            $id: id || Math.round( 1000 * Math.random() ),
            Requirement: null,
            Name: name || "DefaultName (dashboardTypes.js line 87)",
            Unit: unit || "Unitless",
            Value: value || null
        };
    }

    function testbenchParameter( name, value, unit, id ) {
        return {
            $id: id || Math.round( 1000 * Math.random() ),
            Name: name || "DefaultName (dashboardTypes.js line 87)",
            Unit: unit || "Unitless",
            Value: value || null
        };
    }

    function requirementsJson() {
        return {
            name: "Undefined",
            children: []
        };
    }

    function testbenchManifest( designID, designName, testbenchName ) {
        return {
            "Status": "OK",
            "CopyTestResults": false,
            "Parameters": [],
            "TierLevel": 0,
            "Artifacts": [],
            "VisualizationArtifacts": [],
            "DesignName": designName || "no design name provided",
            "LimitChecks": [],
            "Metrics": [],
            "DesignID": designID || "no id provided",
            "Dependencies": [],
            "Steps": [],
            "TestBench": testbenchName || "No name provided",
            "Created": "some time in the future"
        };
    }

    return {
        manifestProjectJson: manifestProjectJson,
        resultsMetaresultsJson: resultsMetaresultsJson,
        resultMetaresult: resultMetaresult,
        testbenchJson: testbenchJson,
        testbenchMetric: testbenchMetric,
        requirementsJson: requirementsJson,
        testbenchParameter: testbenchParameter
    };

} );
/**
 * Generated by PluginGenerator from webgme on Tue Nov 04 2014 13:59:08 GMT-0600 (Central Standard Time).
 */

define( 'plugin/GenerateDashboard/GenerateDashboard/GenerateDashboard',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'ejs',
    'plugin/GenerateDashboard/GenerateDashboard/Templates/Templates',
    'jszip',
    'plugin/GenerateDashboard/GenerateDashboard/meta',
    'plugin/GenerateDashboard/GenerateDashboard/dashboardTypes',
    'plugin/AdmExporter/AdmExporter/AdmExporter',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, ejs, TEMPLATES, JSZip, MetaTypes, DashboardTypes, AdmExporter, Converter ) {
    

    /**
     * Initializes a new instance of GenerateDashboard.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin GenerateDashboard.
     * @constructor
     */
    var GenerateDashboard = function () {
        // Call base class' constructor.
        PluginBase.call( this );

        this.metaTypes = MetaTypes;
        this.admExporter = null;
        this.designSpaceNode = null;
        this.json2xml = null;
        this.testResultObjectIDs = [
            "/243203739/1914067160/1594627875/738670268/1604609344/1138983316",
            "/243203739/1914067160/1594627875/738670268/1604609344/638117119",
            "/243203739/1914067160/1594627875/738670268/14675327/721601556",
            "/243203739/1914067160/1594627875/738670268/14675327/669656366"
        ];

        this.dashboardObject = {
            dashboardHashLF: "ada66617178a84bc9d9b7d9a2510019e1e6ade06",
            dashboardHashCRLF: "ed3320752e9598774183d92a0600b9c53d85d3c2",
            designs: {},
            designSpace: {
                name: null,
                data: null
            },
            requirements: "dummy requirements blob hash",
            results: {
                resultsMetaresultsJson: null,
                results: {}
            },
            testBenches: {},
            manifestProjectJson: null
        };
    };

    // Prototypal inheritance from PluginBase.
    GenerateDashboard.prototype = Object.create( PluginBase.prototype );
    GenerateDashboard.prototype.constructor = GenerateDashboard;

    /**
     * Gets the name of the GenerateDashboard.
     * @returns {string} The name of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getName = function () {
        return "Generate Dashboard";
    };

    /**
     * Gets the semantic version (semver.org) of the GenerateDashboard.
     * @returns {string} The version of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the GenerateDashboard.
     * @returns {string} The description of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getDescription = function () {
        return "Takes a list of Result Object IDs, and create a Dashboard package for visualization";
    };

    /**
     * Gets the configuration structure for the TestBenchRunner.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getConfigStructure = function () {
        return [ {
            'name': 'resultIDs',
            'displayName': 'Result Object IDs',
            'description': 'IDs of Result objects to add to the Generated Dashboard, separated by semicolons.',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        } ];
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    GenerateDashboard.prototype.main = function ( callback ) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            //config = self.getCurrentConfig(),
            workSpaceName,
            workSpaceNode,
            designName = self.core.getAttribute( self.activeNode, 'name' ),
            designObjectID = self.core.getPath( self.activeNode ),
            designID = self.core.getGuid( self.activeNode ),
            currentConfig = self.getCurrentConfig(),
            resultObjectIDs = [];

        if ( self.isMetaTypeOf( self.activeNode, self.META.Container ) === false ) {
            self.createMessage( null, 'This plugin must be called from a Container.', 'error' );
            callback( null, self.result );
            return;
        }

        if ( currentConfig.resultIDs ) {
            resultObjectIDs = currentConfig.resultIDs.split( ';' );
        }

        self.updateMETA( self.metaTypes );
        self.json2xml = new Converter.Json2xml();
        self.designSpaceNode = self.activeNode;

        // Run AdmExporter to get design_space/%ThisDesignName%.adm
        self.initializeAdmExporter( designObjectID );

        // self.activeNode needs to be the design, 2nd argument is bool: include/return acm files
        var exploreDesignCallbackFunction = function ( err ) {
            if ( err ) {
                self.logger.error( 'AdmExporter.exploreDesign failed with error: ' + err );
                self.logger.error( err );
                self.result.setSuccess( false );
                return callback( err, self.result );
            }

            // get the DesignSpace adm
            self.dashboardObject.designSpace.name = designName;
            self.dashboardObject.designSpace.data = {
                Design: self.admExporter.admData
            };

            // Create the manifest.project.json
            workSpaceNode = self.getWorkspaceNode( self.designSpaceNode );
            workSpaceName = self.core.getAttribute( workSpaceNode, 'name' );

            self.dashboardObject.manifestProjectJson = new DashboardTypes.manifestProjectJson( workSpaceName );

            // Create the results.metaresults.json
            self.dashboardObject.results.resultsMetaresultsJson = new DashboardTypes.resultsMetaresultsJson();

            // Create requirements
            self.dashboardObject.requirements = new DashboardTypes.requirementsJson();

            var getResultsCallbackFunction = function ( err ) {
                if ( err ) {
                    self.logger.error( err );
                    self.result.setSuccess( false );
                    return callback( err, self.result );
                }

                self.createDashboardArtifact( function ( err, dashboardArtifactHash ) {
                    if ( err ) {
                        self.logger.error( err );
                        self.result.setSuccess( false );
                        return callback( err, self.result );
                    }

                    self.result.addArtifact( dashboardArtifactHash );
                    self.result.setSuccess( true );
                    self.save( 'added obj', function ( err ) {
                        callback( null, self.result );
                    } );
                } );
            };

            self.getResults( designName, designID, resultObjectIDs, getResultsCallbackFunction );

        };

        self.admExporter.exploreDesign( self.designSpaceNode, false, exploreDesignCallbackFunction );
    };

    GenerateDashboard.prototype.createDashboardArtifact = function ( callback ) {
        var self = this,
            filesToAdd = {},
            dashboardArtifact = self.blobClient.createArtifact( 'dashboard' ),
            filePath,
            key;

        // designs (configurations)
        for ( key in self.dashboardObject.designs ) {
            if ( self.dashboardObject.designs.hasOwnProperty( key ) ) {
                filePath = "designs/" + key + ".adm";
                self.dashboardObject.manifestProjectJson.Project.Configurations.push( "./" + filePath );
                filesToAdd[ filePath ] = self.json2xml.convertToString( self.dashboardObject.designs[ key ] );
            }
        }

        // design-space
        filePath = "design-space/" + self.dashboardObject.designSpace.name + ".adm";
        self.dashboardObject.manifestProjectJson.Project.DesignSpaceModels.push( "./" + filePath );
        filesToAdd[ filePath ] = self.json2xml.convertToString( self.dashboardObject.designSpace.data );

        // requirements
        filePath = "requirements/requirements.json";
        filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.requirements, null, 4 );

        // results.metaresults.json
        filePath = "results/results.metaresults.json";
        filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.results.resultsMetaresultsJson, null, 4 );

        // results
        for ( key in self.dashboardObject.results.results ) {
            if ( self.dashboardObject.results.results.hasOwnProperty( key ) ) {
                filePath = "results/" + key + "/testbench_manifest.json";
                filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.results.results[ key ], null, 4 );
            }
        }

        // test-benches
        for ( key in self.dashboardObject.testBenches ) {
            if ( self.dashboardObject.testBenches.hasOwnProperty( key ) ) {
                filePath = "test-benches/" + key;
                self.dashboardObject.manifestProjectJson.Project.TestBenches.push( "./" + filePath );
                filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.testBenches[ key ], null, 4 );
            }
        }

        filesToAdd[ "manifest.project.json" ] = JSON.stringify( self.dashboardObject.manifestProjectJson, null, 4 );

        filesToAdd[ "launch_SimpleHTTPServer.cmd" ] = ejs.render( TEMPLATES[ 'launch_SimpleHTTPServer.cmd.ejs' ] );

        dashboardArtifact.addFiles( filesToAdd, function ( err, fileHashes ) {
            var addDashboardFiles;
            if ( err ) {
                callback( err, null );
            }

            // add the dashboard package to the artifact
            addDashboardFiles = function ( dashboardMetadata ) {
                var path,
                    hashToAdd,
                    mdContent = dashboardMetadata.content,
                    hashCounter = Object.keys( dashboardMetadata.content )
                        .length,
                    errors = '',
                    addDashboardHashCounterCallback = function ( err, addedHash ) {
                        if ( err ) {
                            errors += err;
                        }

                        self.logger.info( "Added hash to artifact: " + addedHash );

                        hashCounter -= 1;
                        if ( hashCounter === 0 ) {
                            if ( errors ) {
                                callback( errors, null );
                            }

                            dashboardArtifact.save( callback );
                        }
                    };

                for ( path in mdContent ) {
                    if ( mdContent.hasOwnProperty( path ) ) {
                        hashToAdd = mdContent[ path ].content;

                        dashboardArtifact.addObjectHash( path, hashToAdd, addDashboardHashCounterCallback );
                    }
                }
            };

            self.blobClient.getMetadata( self.dashboardObject.dashboardHashLF, function ( err,
                dashboardMetadata ) {
                if ( err ) {
                    self.logger.info( 'Could not find hash for dashboard LF ' + self.dashboardObject.dashboardHashLF );
                    self.blobClient.getMetadata( self.dashboardObject.dashboardHashCRLF, function ( err,
                        dashboardMetadata ) {
                        if ( err ) {
                            self.logger.info( 'Could not find hash for dashboard CRLF ' +
                                self.dashboardObject.dashboardHashCRLF );
                            self.createMessage( self.designSpaceNode,
                                "Could not add dashboard files from blob. Add them manually" );
                            dashboardArtifact.save( callback );
                        } else {
                            addDashboardFiles( dashboardMetadata );
                        }
                    } );
                } else {
                    addDashboardFiles( dashboardMetadata );
                }
            } );
        } );
    };

    GenerateDashboard.prototype.getResults = function ( designSpaceName, designSpaceID, resultObjectIDs, callback ) {
        var self = this,
            resultCounter = resultObjectIDs.length,
            cumulativeError = "",
            decrementCounterCallback,
            loadByPathCallbackFunction,
            loadDesertConfigChildrenCallback,
            loadDesertConfigSetChildrenCallback,
            loadDesignSpaceChildrenCallback,
            i,
            ithChild,
            iResult,
            iConfig,
            finished = false;

        decrementCounterCallback = function ( err ) {
            if ( err ) {
                cumulativeError += err;
            }

            resultCounter -= 1;

            if ( resultCounter === 0 ) {
                return callback( cumulativeError );
            }
        };

        if ( resultCounter !== 0 ) {
            // Iterate over the user-defined list of Result IDs (async with counter)
            loadByPathCallbackFunction = function ( err, loadedNode ) {
                if ( err ) {
                    return decrementCounterCallback( err );
                }

                self.readAndModifyResultData( loadedNode, designSpaceName, designSpaceID, decrementCounterCallback );
            };

            for ( i = 0; i < resultObjectIDs.length; i++ ) {

                self.core.loadByPath( self.rootNode, resultObjectIDs[ i ], loadByPathCallbackFunction );
            }

        } else {

            loadDesertConfigChildrenCallback = function ( err, resultNodes ) {
                if ( err ) {
                    return callback( err );
                }

                if ( resultNodes.length > 0 ) {
                    // only want to get results from one configuration set ("firstOrDefault")
                    finished = true;
                }

                resultCounter += resultNodes.length;

                for ( iResult = 0; iResult < resultNodes.length; iResult++ ) {
                    if ( self.isMetaTypeOf( resultNodes[ iResult ], self.metaTypes.Result ) ) {
                        self.readAndModifyResultData( resultNodes[ iResult ], designSpaceName, designSpaceID,
                            decrementCounterCallback );
                    }
                }
            };

            loadDesertConfigSetChildrenCallback = function ( err, desertConfigs ) {
                if ( err ) {
                    return callback( err );
                }

                for ( iConfig = 0; iConfig < desertConfigs.length; iConfig++ ) {
                    if ( self.isMetaTypeOf( desertConfigs[ iConfig ], self.metaTypes.DesertConfiguration ) ) {
                        self.core.loadChildren( desertConfigs[ iConfig ], loadDesertConfigChildrenCallback );
                    }
                }
            };

            loadDesignSpaceChildrenCallback = function ( err, designSpaceChildren ) {
                if ( err ) {
                    return callback( err );
                }

                for ( i = 0; i < designSpaceChildren.length; i++ ) {
                    if ( finished ) {
                        // only want to get results from one configuration set ("firstOrDefault")
                        continue;
                    }

                    ithChild = designSpaceChildren[ i ];
                    if ( self.isMetaTypeOf( ithChild, self.metaTypes.DesertConfigurationSet ) ) {
                        self.createMessage( ithChild, "Created dashboard for DesertConfigurationSet.", 'info' );
                        self.core.loadChildren( ithChild, loadDesertConfigSetChildrenCallback );
                    }
                }
            };

            self.core.loadChildren( self.designSpaceNode, loadDesignSpaceChildrenCallback );
        }
    };

    GenerateDashboard.prototype.readAndModifyResultData = function ( resultNode, designSpaceName, designSpaceID,
        callback ) {
        var self = this,
            tbManifestHash = self.core.getAttribute( resultNode, 'Artifacts' ),
            cfgAdmHash = self.core.getAttribute( resultNode, 'CfgAdm' ),
            configNode = self.core.getParent( resultNode ), // the parent config object
            configNodeName = self.core.getAttribute( configNode, 'name' ), // the webgme name for the config
            configName = configNodeName.replace( ". ", "_" )
                .replace( ": ", "_" ), // the 'safer' name
            configNodeGuid = self.core.getGuid( configNode ); // the DesignID for this result's config

        self.getTestbenchManifest( tbManifestHash, function ( err, tbManifestJson ) {
            if ( err ) {
                return callback( err );
            }

            // Append the config name to the design space name (e.g., Wheel + _ + Conf_no_1)
            configName = designSpaceName + '_' + configName;

            self.processTestbenchManifest( tbManifestJson, designSpaceName, configName, configNodeGuid );

            // Check if there is already an adm for this config (multiple results per config)
            if ( self.dashboardObject.designs.hasOwnProperty( configName ) ) {
                callback( null );
            } else {
                self.getCfgAdm( cfgAdmHash, function ( err, admJson ) {
                    if ( err ) {
                        return callback( err );
                    }

                    // 'rename' it (designSpaceName), and set the ID (designSpaceID)
                    admJson.Design[ '@DesignID' ] = configNodeGuid;
                    admJson.Design[ '@Name' ] = configName;
                    admJson.Design.RootContainer[ '@Name' ] = configName;
                    admJson.Design[ '@DesignSpaceSrcID' ] = '{' + designSpaceID + '}';

                    self.dashboardObject.designs[ configName ] = admJson;

                    callback( null );
                } );
            }
        } );
    };

    GenerateDashboard.prototype.processTestbenchManifest = function ( tbManifestJson, designSpaceName, configName,
        configNodeGuid ) {
        var self = this,
            resultDirName,
            resultMetaresult,
            testBenchName = tbManifestJson.TestBench,
            testbenchJson = new DashboardTypes.testbenchJson( testBenchName ),
            tbParam,
            tbMetric,
            i;

        // modify the testbench_manifest.json
        tbManifestJson.DesignName = configName;
        tbManifestJson.DesignID = '{' + configNodeGuid + '}';

        // add to the results.metaresults.json object
        // generate a semi-random result directory name
        resultDirName = Math.random()
            .toString( 36 )
            .substring( 8 );
        resultDirName += Object.keys( self.dashboardObject.results.results )
            .length;

        resultMetaresult =
            new DashboardTypes.resultMetaresult( configNodeGuid, tbManifestJson.TestBench, tbManifestJson.Created,
                resultDirName );

        self.dashboardObject.results.results[ resultDirName ] = tbManifestJson;
        self.dashboardObject.results.resultsMetaresultsJson.Results.push( resultMetaresult );

        // Generate a testbench description
        // Parameters
        for ( i = 0; i < tbManifestJson.Parameters.length; i++ ) {
            tbParam = tbManifestJson.Parameters[ i ];
            testbenchJson.Parameters.push(
                new DashboardTypes.testbenchParameter( tbParam.Name, tbParam.Value, tbParam.Unit, i + 1 ) );
        }
        // Metrics
        for ( i = 0; i < tbManifestJson.Metrics.length; i++ ) {
            tbMetric = tbManifestJson.Metrics[ i ];
            testbenchJson.Metrics.push(
                new DashboardTypes.testbenchMetric( tbMetric.Name, tbMetric.Value, tbMetric.Unit, i + 1 ) );
        }

        testBenchName += ".testbench.json";
        self.dashboardObject.testBenches[ testBenchName ] = testbenchJson;
    };

    GenerateDashboard.prototype.getTestbenchManifest = function ( tbManifestHash, callback ) {
        var self = this,
            errMsg;

        self.blobClient.getObject( tbManifestHash, function ( err, tbManifestContent ) {
            if ( err ) {
                errMsg = "Could not get testbench_manifest from " + tbManifestHash + ": " + err;
                return callback( errMsg, null );
            }

            var tbManifestZip = new JSZip( tbManifestContent ),
                tbManifestObject = tbManifestZip.file( /testbench_manifest.json/ ),
                tbManifestJson;

            if ( tbManifestObject === null ) {
                errMsg = "Could not get testbench_manifest from " + tbManifestHash + ": " + err;
                self.logger.error( errMsg );
                return callback( errMsg, null );
            }

            // regular expression will return an array, so we need to get the first item
            tbManifestJson = JSON.parse( tbManifestObject[ 0 ].asText() );

            callback( null, tbManifestJson );
        } );
    };

    GenerateDashboard.prototype.getCfgAdm = function ( cfgAdmHash, callback ) {
        var self = this,
            errMsg;

        self.blobClient.getObject( cfgAdmHash, function ( err, cfgAdmObjectContent ) {
            if ( err ) {
                errMsg = "Could not get adm from xml " + cfgAdmHash + ": " + err;
                return callback( errMsg, null );
            }

            var zip = new JSZip( cfgAdmObjectContent ),
                cfgAdmXml = zip.file( /\.adm/ ), // regular expression will return an array
                cfgAdmJson;

            if ( cfgAdmXml === null ) {
                errMsg = "Could not get adm from xml " + cfgAdmHash + ": " + err;
                self.logger.error( errMsg );
                return callback( errMsg, null );
            }

            // need to convert to json for editing
            cfgAdmJson = self.convertXml2Json( cfgAdmXml[ 0 ].asArrayBuffer() );

            if ( cfgAdmJson instanceof Error ) {
                errMsg = 'Given adm not valid xml: ' + cfgAdmJson.message;
                return callback( errMsg, null );
            }

            callback( null, cfgAdmJson );
        } );
    };

    GenerateDashboard.prototype.convertXml2Json = function ( modelDescriptionXml ) {
        var self = this,
            arrayElementsInXml = {
                Design: false,
                RootContainer: false,
                Value: false,
                Container: true,
                Connector: true,
                Property: true,
                Formula: true,
                Operand: true,
                ValueFlowMux: true,
                ComponentInstance: true,
                PrimitivePropertyInstance: true,
                ConnectorInstance: true,
                PortInstance: true,
                Role: true,
                Port: true
            },
            converter = new Converter.Xml2json( {
                skipWSText: true,
                arrayElements: arrayElementsInXml
            } );

        return converter.convertFromBuffer( modelDescriptionXml );
    };

    GenerateDashboard.prototype.initializeAdmExporter = function ( designPath ) {
        var self = this;
        if ( self.admExporter === null ) {
            self.admExporter = new AdmExporter();
            self.admExporter.meta = self.metaTypes; // meta is defined here (points to adjacent meta.js file)
            self.admExporter.META = self.META; // META is from PluginBase
            self.admExporter.core = self.core;
            self.admExporter.logger = self.logger;
            self.admExporter.result = self.result;
            self.admExporter.rootPath = designPath || null;
            self.admExporter.rootNode = self.rootNode;
            self.logger.info( 'AdmExporter had not been initialized - created a new instance.' );
        } else {
            self.admExporter.acmFiles = {};
            self.admExporter.gatheredAcms = {};
            self.admExporter.rootPath = designPath || null;
            self.admExporter.includeAcms = true;
            self.logger.info(
                'AdmExporter had already been initialized - reset acmFiles, gatheredAcms and rootPath.' );
        }
    };

    GenerateDashboard.prototype.getWorkspaceNode = function ( node ) {
        var self = this;
        while ( node ) {
            if ( self.isMetaTypeOf( node, self.metaTypes.WorkSpace ) ) {
                return node;
            }
            node = self.core.getParent( node );
        }
        self.logger.error( 'Could not find WorkSpace!!' );
    };

    return GenerateDashboard;
} );
/**
 * Generated by PluginGenerator from webgme on Fri Nov 14 2014 16:45:18 GMT-0600 (Central Standard Time).
 */

define( 'plugin/SaveDesertConfigurations/SaveDesertConfigurations/meta',[], function () {
    
    return {
        'ACMFolder': '/1008889918/398267330',
        'ADMEditorModelingLanguage': '/1008889918',
        'ADMFolder': '/1008889918/755698918',
        'AssemblyRoot': '/1008889918/1502717053',
        'ATMFolder': '/1008889918/794302266',
        'AVMComponentModel': '/1008889918/1998840078',
        'AVMTestBenchModel': '/1008889918/1624079113',
        'Connector': '/1008889918/1045980796',
        'ConnectorComposition': '/1008889918/488584186',
        'Container': '/1008889918/1993805430',
        'CustomFormula': '/1008889918/1299690106',
        'DesertConfiguration': '/1008889918/1949671222',
        'DesertConfigurationSet': '/1008889918/206008088',
        'DomainModel': '/1008889918/481954284',
        'DomainPort': '/1008889918/126974487',
        'FCO': '/1',
        'Formula': '/1008889918/803021327',
        'Metric': '/1008889918/1328879441',
        'PortMap': '/1008889918/1474284259',
        'Property': '/1008889918/34094492',
        'Requirement': '/1008889918/1220837843',
        'RequirementBase': '/1008889918/1010911100',
        'RequirementCategory': '/1008889918/1598195376',
        'RequirementsFolder': '/1008889918/1675023230',
        'Result': '/1008889918/1368062975',
        'Settings': '/1008889918/319211427',
        'SimpleFormula': '/1008889918/711037118',
        'Task': '/1008889918/91705197',
        'Test': '/1008889918/1922772359',
        'ValueFlowComposition': '/1008889918/756182296',
        'Workflow': '/1008889918/891929219',
        'WorkSpace': '/1008889918/1826321976',
    };
} );
/*globals define */

/**
 * Generated by PluginGenerator from webgme on Fri Nov 14 2014 16:45:18 GMT-0600 (Central Standard Time).
 */

define( 'plugin/SaveDesertConfigurations/SaveDesertConfigurations/SaveDesertConfigurations',[ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'plugin/SaveDesertConfigurations/SaveDesertConfigurations/meta'
], function ( PluginConfig, PluginBase, MetaTypes ) {
    

    /**
     * Initializes a new instance of SaveDesertConfigurations.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin SaveDesertConfigurations.
     * @constructor
     */
    var SaveDesertConfigurations = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = MetaTypes;
    };

    // Prototypal inheritance from PluginBase.
    SaveDesertConfigurations.prototype = Object.create( PluginBase.prototype );
    SaveDesertConfigurations.prototype.constructor = SaveDesertConfigurations;

    /**
     * Gets the name of the SaveDesertConfigurations.
     * @returns {string} The name of the plugin.
     * @public
     */
    SaveDesertConfigurations.prototype.getName = function () {
        return "Save Desert Configurations";
    };

    /**
     * Gets the semantic version (semver.org) of the SaveDesertConfigurations.
     * @returns {string} The version of the plugin.
     * @public
     */
    SaveDesertConfigurations.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the configuration structure for the SaveDesertConfigurations.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    SaveDesertConfigurations.prototype.getConfigStructure = function () {
        return [ {
            'name': 'setData',
            'displayName': 'Configuration Set Data',
            'description': '',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        }, {
            'name': 'configurations',
            'displayName': 'Configurations',
            'description': 'List of configurations.',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        } ];
    };


    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    SaveDesertConfigurations.prototype.main = function ( callback ) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            currentConfig = self.getCurrentConfig(),
            setData,
            setNode,
            configurations;

        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }

        if ( self.isMetaTypeOf( self.activeNode, self.META.Container ) === false ) {
            self.createMessage( null, 'This plugin must be called from an Container.', 'error' );
            callback( null, self.result );
            return;
        }

        self.updateMETA( self.meta );
        setData = JSON.parse( currentConfig.setData );
        //        console.log(setData);
        setNode = self.saveSetNode( self.activeNode, setData );

        configurations = JSON.parse( currentConfig.configurations );
        //        console.log(configurations);
        self.saveConfigurations( setNode, configurations );
        self.result.setSuccess( true );
        self.save( 'Configurations saved to model.', function ( err ) {
            callback( null, self.result );
        } );

    };

    SaveDesertConfigurations.prototype.saveSetNode = function ( containerNode, setData ) {
        var self = this,
            setNode;
        setNode = self.core.createNode( {
            parent: containerNode,
            base: MetaTypes.DesertConfigurationSet
        } );
        self.core.setAttribute( setNode, 'name', setData.name );
        if ( setData.description ) {
            self.core.setAttribute( setNode, 'INFO', setData.description );
        }

        return setNode;
    };

    SaveDesertConfigurations.prototype.saveConfigurations = function ( setNode, configurations ) {
        var self = this,
            i,
            configData,
            configNode;
        for ( i = 0; i < configurations.length; i += 1 ) {
            configData = configurations[ i ];
            configNode = self.core.createNode( {
                parent: setNode,
                base: MetaTypes.DesertConfiguration
            } );
            self.core.setAttribute( configNode, 'name', configData.name );
            self.core.setAttribute( configNode, 'AlternativeAssignment', JSON.stringify( configData.alternativeAssignments ) );
        }

    };


    return SaveDesertConfigurations;
} );
/*globals define, WebGMEGlobal */
define('webcyphy.plugins',
    [
        'xmljsonconverter',
        'executor/ExecutorClient',
        'plugin/AcmImporter/AcmImporter/AcmImporter',
        'plugin/AdmImporter/AdmImporter/AdmImporter',
        'plugin/AtmImporter/AtmImporter/AtmImporter',
        'plugin/AdmExporter/AdmExporter/AdmExporter',
        'plugin/TestBenchRunner/TestBenchRunner/TestBenchRunner',
        'plugin/ExportWorkspace/ExportWorkspace/ExportWorkspace',
        'plugin/GenerateDashboard/GenerateDashboard/GenerateDashboard',
        'plugin/SaveDesertConfigurations/SaveDesertConfigurations/SaveDesertConfigurations'
    ], function (Converters,
                 ExecutorClient,
                 AcmImporter,
                 AdmImporter,
                 AtmImporter,
                 AdmExporter,
                 TestBenchRunner,
                 ExportWorkspace,
                 GenerateDashboard,
                 SaveDesertConfigurations) {
        
        WebGMEGlobal.classes = WebGMEGlobal.classes || {};
        WebGMEGlobal.classes.ExecutorClient = ExecutorClient;
        WebGMEGlobal.classes.Converters = Converters;
        WebGMEGlobal.plugins.AcmImporter = AcmImporter;
        WebGMEGlobal.plugins.AdmImporter = AdmImporter;
        WebGMEGlobal.plugins.AtmImporter = AtmImporter;
        WebGMEGlobal.plugins.AdmExporter = AdmExporter;
        WebGMEGlobal.plugins.ExportWorkspace = ExportWorkspace;
        WebGMEGlobal.plugins.TestBenchRunner = TestBenchRunner;
        WebGMEGlobal.plugins.GenerateDashboard = GenerateDashboard;
        WebGMEGlobal.plugins.SaveDesertConfigurations = SaveDesertConfigurations;
    });


require(["webcyphy.plugins"]);
}());