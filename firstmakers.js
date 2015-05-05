/**
 * Copyright 2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

// If you use this as a template, update the copyright with your own name.

// Ernesto Node-RED node file


module.exports = function(RED) {
    "use strict";
    // require any external libraries we may need....
    var firmata = require('firmata');
    var serialport =require('serialport');
    var fs = require('fs');
    var Q = require('q');
    var portlist = serialport.list(function (err, ports) {
        portlist = ports;
    });

    // Arduino / Firmta board (when opened) undefined if not open
    var myArduino = undefined;
    var oldBoards = [];  // Store old boards to avoid wild events


    /*
    * getArduino
    * Promise that gets current board.
    * If board is not open, attempts to connect to the first serialport available
    * If not possible to connect, rejects the promise with an error.
    */
    var getArduino = function() {
        var deferred = Q.defer();

        if (myArduino!==undefined) {
            deferred.resolve(myArduino);
        } else {
            attemptToConnect()
            .then(function(board) {
                myArduino = board;
                deferred.resolve(board);
            })
            .catch(function(err) {
                deferred.reject(err);
            })
        }

        return deferred.promise;
    }


    /*
    * closeHandler
    * Called when the serialport is closed / disconnected
    */
    var closeHandler = function(silent) {

        if (myArduino) {
            var port = myArduino.sp.path;

            myArduino.sp.removeListener('disconnect', closeHandler);
            myArduino.sp.removeListener('close', closeHandler);
            //myArduino.serialport.removeListener('error', myself.arduino.errorHandler);
            
            oldBoards.push(myArduino);
            myArduino = undefined;
        };

        console.log('Board was disconnected from port '+ port)
    }
            
    var getArduinoPortList = function() {
        var deferred = Q.defer();

        var portList = [];
        var portcheck = /usb|DevB|rfcomm|acm|^com/i; // Not sure about rfcomm! We must dig further how bluetooth works in Gnu/Linux

        serialport.list(function (err, ports) { 
            if (err) {
                deferred.reject(err);
            } else { 
                ports.forEach(function(each) { 
                    if(portcheck.test(each.comName)) {
                        portList.push(each.comName); 
                    }
                });
                deferred.resolve(portList);
            }
        });

        return deferred.promise;

    }

    var attemptToConnect = function() {
        var deferred = Q.defer();

        getArduinoPortList()
        .then(function(ports) {
            if (ports.length>0) {
                
                var board = undefined;

                // set timeout for connection
                var to = setTimeout(function() {
                    deferred.reject(new Error("Cound not connect to arduino board at "+ports[0]));
                },10000);

                var board = new firmata.Board(ports[0],function(){
                   clearTimeout(to);
                    board.sp.on('close', closeHandler);
                    board.sp.on('disconnect', closeHandler);
                    deferred.resolve(board);
                  //arduino is ready to communicate
                });  

            } else {
                deferred.reject(new Error("No arduino boards available"));
            }  
        })
        
        return deferred.promise;
    }

    var closeBoard = function() {
        var deferred = Q.defer();

        if (myArduino !== undefined) {
            myArduino.close(function() {
                deferred.resolve();
            })
        } else {
            deferred.resolve();
        }

        return deferred.promise;
    }

    // The main node definition - most things happen in here
    function FirstMakersNode(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        // Store local copies of the node configuration (as defined in the .html)
        this.pin = config.pin;

        // copy "this" object in case we need it in context of callbacks of other functions.
        var node = this;

        node.makerBoardConfig = RED.nodes.getNode(config.board);

        // respond to inputs....
        this.on('input', function (msg) {

            //msg.pin = node.pin;
            getArduino()
            .then(function(board) {
                
                var sensors = {};
                
                // get the value for each analog pin
                board.analogPins.forEach(function(pin, analogPin) {
                    board.pinMode(board.analogPins[analogPin], board.MODES.ANALOG);
    
                    sensors["a"+analogPin] = board.pins[board.analogPins[analogPin]].value;
                })
                
                msg.payload = sensors;
                node.send(msg);
            })
            .catch(function(err) {
                node.warn(err);
            })
         
        });

        this.on("close", function() {
            closeBoard();


            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: node.client.disconnect();
        });
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("firstmakers",FirstMakersNode);
}
