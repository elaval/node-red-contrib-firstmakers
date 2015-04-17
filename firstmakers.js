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
    //var foo = require("foo-library");
    //var Galileo = require("galileo-io");
    //var board = new Galileo();
    var ArduinoFirmata = require('arduino-firmata');
    var fs = require('fs');
    var Q = require('q');
    var portlist = ArduinoFirmata.list(function (err, ports) {
        portlist = ports;
    });

    // Arduino / Firmta board (when opened) undefined if not open
    var myArduino = undefined;
    var oldBoards = [];  // Store old boards to avoid wild events

    // HID management (for SLT boards)
    var HID = require('node-hid');

    var mySLT = undefined;

    var commandcodes = {
        'led' : 0x80,
        'temp_light' : 0x81,
        'temp': 0x82,
        'ligth': 0x83,
        'bootloader' : 0x85,
        'humidity' : 0x86,
        'temp_light_humidity' : 0x87
    };

    var getSLTDevice = function() {
        var deferred = Q.defer();

        if (mySLT) {
            deferred.resolve(mySLT);
        } else {
            var devices = HID.devices();
            var devicePath = null
            for (var i in devices) {
                var device = devices[i];
                if (device.vendorId == "1240" && device.productId == "63" && !devicePath) {
                    devicePath = device.path;
                }
            }
            if (devicePath) {
                mySLT = new HID.HID(devicePath);
                mySLT.on('error', sltErrorHandler);
                deferred.resolve(mySLT); 
            } else {
                deferred.reject(new Error("No SLT board available"));
            }

        }

        return deferred.promise;
    }

    var sltErrorHandler = function() {
        console.log("ERROR HANDLER")

        if (mySLT !== undefined) {
            mySLT.removeListener('error', sltErrorHandler);
            mySLT.close();
            mySLT = undefined;
        }
        
    }

    var getDataLHT = function() {
        var deferred = Q.defer();

        getSLTDevice()
        .then(function(device) {
            var outdata = new Buffer(64);
            outdata[0] = commandcodes['temp_light'];
            try {
                device.write(outdata);
                device.read(function(err,data) {
                    var celsius = ((data[2] << 8) + data[1]);
                    celsius = (celsius * 0.0625);

                    var lux = (data[4] << 8) + data[3];
                    lux = lux*1.2;

                    deferred.resolve({"celsius":celsius, "lux":lux});
                })

            } 
            catch(err) {
                console.log("CATCH");
                deferred.reject(err);
            }

        })
        .catch(function(err) {
            deferred.reject(err);
        })
 
        return deferred.promise;

    }

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
            var port = myArduino.serialport.path;

            //myArduino.serialport.removeListener('disconnect', disconnectHandler);
            myArduino.serialport.removeListener('close', closeHandler);
            //myArduino.serialport.removeListener('error', myself.arduino.errorHandler);
            
            oldBoards.push(myArduino);
            myArduino = undefined;
        };

        console.log('Board was disconnected from port '+ port)
    }
            

    var attemptToConnect = function() {
        var deferred = Q.defer();
        
        ArduinoFirmata.list(function (err, ports) {
            if (ports.length>0) {
                
                var arduino = new ArduinoFirmata();
                arduino.connect(ports[0]);
                var to = setTimeout(function() {
                    arduino = undefined;
                    deferred.reject(new Error("Cound not connect to arduino board at "+ports[0]));
                },10000);
                arduino.on("boardReady", function() {
                    clearTimeout(to);
                    arduino.serialport.on('close', closeHandler);
                    deferred.resolve(arduino);
                })

            } else {
                deferred.reject(new Error("No arduino boards available"));
            }
            
        });

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

    // The Board Definition - this opens (and closes) the connection
    function MakersBoardNode(n) {
        RED.nodes.createNode(this,n);
        var node = this;

        node.on('close', function(done) {
            if (myArduino) {
                try {
                    myArduino.close(function() {
                        done();
                        if (RED.settings.verbose) { node.log("port closed"); }
                    });
                } catch(e) { done(); }
            } else { done(); }
        });
    }
    RED.nodes.registerType("makers-board",MakersBoardNode);

    // The main node definition - most things happen in here
    function MakersSensorNode(config) {
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
                var sensors = [];
                sensors[0] =  board.analogRead(0);
                sensors[1] =  board.analogRead(1);
                sensors[2] =  board.analogRead(2);
                sensors[3] =  board.analogRead(3);
                sensors[4] =  board.analogRead(4);
                sensors[5] =  board.analogRead(5);
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
    RED.nodes.registerType("makers-sensor",MakersSensorNode);

    // The main node definition - most things happen in here
    function MakersSLTNode(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        var node = this;

        // respond to inputs....
        this.on('input', function (msg) {
            getDataLHT()
            .then(function(data) {
                msg.payload = data;
                node.send(msg);
            })
            .catch(function(err) {
                node.warn(err);
                sltErrorHandler();

            })
            
        });

        this.on("close", function() {
            //closeBoard();

        });
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("makers-slt",MakersSLTNode);


    RED.httpAdmin.get("/arduinoports", RED.auth.needsPermission("arduino.read"), function(req,res) {
        ArduinoFirmata.list(function (err, ports) {
            res.json(ports);
        });
    });
}
