var fs = require('fs');
var spawn = require('child_process');
var globals = require('./globals');
var pstream = require('./persistentstream');
var spawn = require('child_process');

var panelFd = -1;
var numSustainerErrors = 0;
var numBoosterErrors = 0;
var armed = false;
var launch = false;
var launchSent = false;
var depressTimestamp = 0;

function tryOpenPanelDevice() {

	console.log("Trying to make connection to panel.");

	if (panelFd !== -1) {
		try {
			fs.closeSync(panelFd);
			panelFd = -1;
		} catch (err) {
			console.log("Error closing panel fd.");
			console.log(err);
		}
	}

	try {
		spawn.spawnSync('/dev/stty', ['-F', globals.panelDeviceName, globals.panelBaud, 'raw']);
		fs.open(globals.panelDeviceName, 'r+', function(err, fd) {
			if (!err) {
				console.log("Opened write stream to panel.");
				panelFd = fd;
				var lightString = "bcomm off\nscomm off\nsignite off\nbignite off\nberror off\nserror off\n";
				console.log(lightString);
				fs.write(panelFd, lightString, writeHandler);
		} else {
				console.log(err);
				panelFd = -1;
			}
		});
	} catch (err) {
		console.log("Cannot open panel device " + globals.panelDeviceName);
		setTimeout(tryOpenPanelDevice, 1000);
	}
}

tryOpenPanelDevice();


// Code to turn the launch code OFF
// 7E, 00, 10, 17, 01, 00, 7D, 33, A2, 00, 41, 26, 47, 61, FF, FE, 02, 70, 32, 04, 7D, 5E


function launchPinOff() {
	var code = Buffer.from([0x7E, 0x00, 0x10, 0x17, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x26, 0x47, 0x61, 0xFF, 0xFE, 0x03, 0x70, 0x32, 0x04, 0x7D, 0x5E]);
	fs.open(globals.deviceName, 'w', function(err, fd) {
		if (!err) {
			fs.write(fd, code, 0, 22, function(err, written, buffer) {
				if (!err) {
					//console.log("Write callback");
					console.log("launch code pin low sent.");
				} else {
					console.log(err);
				}
			});
				
			fs.close(fd);
		} else {
			console.log(err);
		}
	});
}

pstream.createPersistentReadStream(globals.panelDeviceName, globals.panelBaud, function(d) {
	var now = (new Date()).getTime();
	var send = false;
	var length = 0;

	for (var i = 0; i < d.length; i++) {

		// 76 = 'L' = launch button down
		if (d[i] === 76 && armed === true) {

			// If the launch button has been depressed for a certain
			// amount of time, then launch.
			if (launch === true && launchSent === false && (now - depressTimestamp) > 1000) {
				// Send the launch code
				code = Buffer.from([0x7E, 0x00, 0x10, 0x17, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x26, 0x47, 0x61, 0xFF, 0xFE, 0x03, 0x70, 0x32, 0x05, 0x7D, 0x5D]);
				fs.open(globals.deviceName, 'w', function(err, fd) {
					if (!err) {
						fs.write(fd, code, 0, 22, function(err, written, buffer) {
							if (!err) {
								launchSent = true;
								console.log("Launch code pin high sent.");
								// Send the launch off code in 100 ms
								setTimeout(launchPinOff, 1000);
								//console.log("Write callback");
							} else {
								console.log(err);
							}
						});
						
						fs.close(fd);
	
					} else {
						console.log(err);
					}
				});
				console.log("LAUNCH");
			}

			// This is the first trigger of the launch button,
			// so start counting how long it has been depressed.
			if (launch === false) {
				console.log("...");
				depressTimestamp = now;
			}

			launch = true;
		// 108 = 'l' = launch button up
		} else if (d[i] === 108) {
			launch = false;
			launchSent = false;
			depressTimestamp = 0;
		}

		if (d[i] === 97 || d[i] === 65) {
			// if armed is false, then be sure to stop the launch
			if (d[i] === 97) {
				launch = false;
				depressTimestamp = 0;
			}
			
			var code = "";
			if (d[i] === 97 && armed === true) {
				send = true;
				armed = false;
				console.log("DISARMED");
				// sustainer code on top, booster on bottom
				code = Buffer.from([
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x57, 0x7d, 0x33, 0x45, 0x01, 0x01, 0x58,
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x01, 0x1B]);
				length = 35;

			} else if (d[i] === 65 && armed === false) {
				send = true;
				armed = true;
				console.log("ARMED");

				code = Buffer.from([
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x57, 0x7d, 0x33, 0x45, 0x01, 0x02, 0x57,
						0x7E, 0x00, 0x0C, 0x00, 0x00, 0x00, 0x7D, 0x33, 0xA2, 0x00, 0x41, 0x25, 0xD1, 0xF6, 0x01, 0x02, 0x1A]);
				length = 35;
			}
		}

		try {
			if (send) {
				fs.open(globals.deviceName, 'w', function(err, fd) {
					if (!err) {
						fs.write(fd, code, 0, length, function(err, written, buffer) {
							console.log("Sent radio code");
							//console.log("Write callback");
						});
						
						fs.close(fd);
	
					} else {
						console.log(err);
					}
				});
				send = false;
			}
		} catch (err) {
			console.log("Could not send arm code");
			console.log(err);
		}
	}
});


function writeHandler(err, written, buffer) {
	if (err) {
		console.log("Write handler error.");
		console.log(err);
		panelFd = -1;
		tryOpenPanelDevice();
	}
}


function pollArm() {
	
	if (panelFd === -1) {
		return;
	}
	try {
		fs.write(panelFd, "arm\n");
		fs.write(panelFd, "launch\n");
	} catch (err) {
		console.log(err);
	}
}

setInterval(pollArm, 100);

module.exports = {
	
	isArmed: function() {
		return armed;
	},

	// Sets the appropriate light to the appropriate state.
	// lightName: scomm, signition, serror, bcomm, bignition, berror, alarm
	// state: on, off
	setLight: function (lightName, state) {
		if (panelFd != -1) {
			try {
				var lightString = lightName + ' ' + state + '\n';
				fs.write(panelFd, lightString, writeHandler);
			} catch (err) {
				console.log("Error in setLight.");
				console.log(err);
				panelFd = -1;
				tryOpenPanelDevice();
			}
		}
	},

	resetLights: function() {
		console.log("Resetting lights");
		this.setLight("serror", "off");
		this.setLight("berror", "off");	
		this.setLight("bcomm", "off");
		this.setLight("scomm", "off");
		this.setLight("signite", "off");
		this.setLight("bignite", "off");
	},

	// Sets the text of the line number
	// line number: 1 - 4
	// msg: no longer than 20 characters (or it will wrap to the next line).
	// Automatically pads msg to fill up the line so old characters are erased
	setLine: function (lineNumber, msg) {
		if (panelFd != -1) {
			try {
				msg = ('' + msg).substring(0, 20);
				var stringToSend = 'line' + lineNumber + '="' + msg + ' '.repeat(20 - msg.length) + '\n';
				fs.write(panelFd, stringToSend, writeHandler);
			} catch(err) {
				console.log("Error in setLine.");
				console.log(err);
				panelFd = -1;
				tryOpenPanelDevice();
			}
		}
	},

	setSustainerError: function() {
		if (numSustainerErrors === 0) {
			this.setLight("serror", "on");
			console.log("Setting error");
		}	
		numSustainerErrors = 1;
	},


	setBoosterError: function() {
		if (numBoosterErrors === 0) {
			this.setLight("berror", "on");
		}
		numBoosterErrors = 1;

	},

	removeBoosterError: function() {
		if (numBoosterErrors === 0) {
			this.setLight("berror", "off");
		}
		numBoosterErrors = 0;
	},


	removeSustainerError: function() {
		if (numSustainerErrors === 0) {
			this.setLight("serror", "off");
		}
		numSustainerErrors = 0;
	},

	addError: function() { console.log("S");addSustainerError(); console.log("B");addBoosterError(); },
	removeError: function() { removeBoosterError(); removeSustainerError(); }
}
