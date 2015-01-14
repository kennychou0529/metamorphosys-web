/**
 * Generated by PluginGenerator from webgme on Thu Jul 17 2014 16:45:05 GMT-0500 (Central Daylight Time).
 */

define( [ 'plugin/PluginConfig', 'plugin/PluginBase', 'plugin/RequirementExporter/RequirementExporter/meta' ], function (
    PluginConfig, PluginBase, MetaTypes ) {
    'use strict';

    /**
     * Initializes a new instance of RequirementExporter.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin RequirementExporter.
     * @constructor
     */
    var RequirementExporter = function () {
        // Call base class' constructor.
        PluginBase.call( this );
        this.meta = null;
        this.acceptErrors = false;
    };

    // Prototypal inheritance from PluginBase.
    RequirementExporter.prototype = Object.create( PluginBase.prototype );
    RequirementExporter.prototype.constructor = RequirementExporter;

    /**
     * Gets the name of the RequirementExporter.
     * @returns {string} The name of the plugin.
     * @public
     */
    RequirementExporter.prototype.getName = function () {
        return "Requirement Exporter";
    };

    /**
     * Gets the semantic version (semver.org) of the RequirementExporter.
     * @returns {string} The version of the plugin.
     * @public
     */
    RequirementExporter.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the RequirementExporter.
     * @returns {string} The description of the plugin.
     * @public
     */
    RequirementExporter.prototype.getDescription = function () {
        return "Exports a set of requirements to a json representation.";
    };

    /**
     * Gets the configuration structure for the RequirementExporter.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    RequirementExporter.prototype.getConfigStructure = function () {
        return [ {
            'name': 'partial',
            'displayName': 'Export partial',
            'description': 'If requirement are not pointing to metrics - a partial json is still generated.',
            'value': true,
            'valueType': 'boolean',
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
    RequirementExporter.prototype.main = function ( callback ) {
        var self = this,
            config = self.getCurrentConfig();
        self.meta = MetaTypes;
        self.updateMETA( self.meta );
        self.acceptErrors = config.partial;
        if ( !self.activeNode ) {
            self.createMessage( null,
                'Active node is not present! This happens sometimes... Loading another model ' +
                'and trying again will solve it most of times.', 'error' );
            callback( 'Active node is not present!', self.result );
            return;
        }

        if ( self.isMetaTypeOf( self.activeNode, self.META.RequirementCategory ) === false ) {
            self.createMessage( null, 'This plugin must be called from a RequirementCategory.', 'error' );
            callback( null, self.result );
            return;
        }

        // TODO: ADD error handling.
        self.visitAllChildrenFromRequirementCategory( self.activeNode, function ( err, rootCategory ) {
            var artie;
            if ( err ) {
                self.logger.error( 'visitAllChildrenFromRequirementCategory had errors, err: ' + err );
                if ( self.acceptErrors === false ) {
                    callback( null, self.result );
                    return;
                }
            }
            artie = self.blobClient.createArtifact( 'requirement' );
            artie.addFile( 'requirements.json', JSON.stringify( rootCategory, null, 4 ), function ( err, hash ) {
                artie.save( function ( err, artieHash ) {
                    self.result.addArtifact( artieHash );
                    self.result.setSuccess( true );
                    callback( null, self.result );
                } );
            } );
        } );
    };

    RequirementExporter.prototype.atModelNode = function ( node, reqCategory, callback ) {
        var self = this,
            nodeType = self.core.getAttribute( self.getMetaType( node ), 'name' ),
            nodeName = self.core.getAttribute( node, 'name' ),
            req = {
                name: nodeName,
                weight: self.core.getAttribute( node, 'weight' ),
                weightNeg: self.core.getAttribute( node, 'weightNeg' ),
                Priority: self.core.getAttribute( node, 'Priority' ),
                description: self.core.getAttribute( node, 'description' )
            };

        self.logger.info( 'At node "' + nodeName + '" of type "' + nodeType + '".' );

        if ( nodeType === 'Requirement' ) {
            req.objective = self.core.getAttribute( node, 'objective' );
            req.threshold = self.core.getAttribute( node, 'threshold' );
            req.KPP = self.core.getAttribute( node, 'KPP' );
            req.

            function = self.core.getAttribute( node, 'function' );
            req.unit = '';
            reqCategory.children.push( req );
            if ( self.core.hasPointer( node, 'Metric' ) ) {
                self.core.loadPointer( node, 'Metric', function ( err, metricNode ) {
                    var tbNode;
                    if ( err ) {
                        self.logger.error( 'Could not load Metric pointer, err: ' + err );
                        callback( 'Could not load Metric pointer, err: ' + err );
                        return;
                    }
                    tbNode = self.core.getParent( metricNode );
                    req.metricName = self.core.getAttribute( metricNode, 'name' );
                    req.testBench = self.core.getAttribute( tbNode, 'name' );
                    callback( null );
                } );
            } else {
                if ( self.acceptErrors ) {
                    self.createMessage( node, 'Requirement "' + nodeName + '" did not have a Metric assigned!',
                        'warning' );
                } else {
                    self.createMessage( node, 'Requirement "' + nodeName + '" did not have a Metric assigned!',
                        'error' );
                }
                req.metricName = 'UNDEFINED';
                req.testBench = 'UNDEFINED';
                callback( 'Missing metrics!' );
            }
        } else if ( nodeType === 'RequirementCategory' ) {
            req.category = true;
            req.children = [];
            reqCategory.children.push( req );
            callback( null, req );
        } else {
            callback( 'Encountered unexpected object at node "' + nodeName + '" of type "' + nodeType + '".' );
        }
    };

    RequirementExporter.prototype.visitAllChildrenFromRequirementCategory = function ( reqNode, callback ) {
        var self = this,
            error = '',
            counter,
            counterCallback,
            rootCategory = {
                name: self.core.getAttribute( reqNode, 'name' ),
                weight: self.core.getAttribute( reqNode, 'weight' ),
                weightNeg: self.core.getAttribute( reqNode, 'weightNeg' ),
                Priority: self.core.getAttribute( reqNode, 'Priority' ),
                description: self.core.getAttribute( reqNode, 'description' ),
                category: true,
                children: []
            };

        counter = {
            visits: 1
        };
        counterCallback = function ( err ) {
            error = err ? error + err : error;
            counter.visits -= 1;
            if ( counter.visits === 0 ) {
                callback( error, rootCategory );
            }
        };

        self.visitAllChildrenRec( reqNode, rootCategory, counter, counterCallback );
    };

    RequirementExporter.prototype.visitAllChildrenRec = function ( node, reqCategory, counter, callback ) {
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
                    return function ( err, reqCategory ) {
                        if ( err && self.acceptErrors === false ) {
                            callback( err );
                            return;
                        }
                        if ( reqCategory ) {
                            self.visitAllChildrenRec( childNode, reqCategory, counter, callback );
                        } else {
                            callback( null );
                        }
                    };
                };
                for ( i = 0; i < children.length; i += 1 ) {
                    self.atModelNode( children[ i ], reqCategory, atModelNodeCallback( children[ i ] ) );
                }
            }
        } );
    };

    return RequirementExporter;
} );