const { execSync } = require("child_process");
console.log("Start Post Python install");
let result = "";
try {
    result = execSync("python3 -V");
} catch (error) {
    console.log("Python 3 not found. Please install minimum python 3.8");
    process.exit(1);
}
result = result.toString("utf8");
console.log(result);
if (!result.includes("Python 3")) {
    console.log("Python 3 not found. Please install minimum python 3.8");
    process.exit(1);
} else {
    console.log("Python 3 found");
    const version = result.split(".")[1];
    if (version < 8) {
        console.log("Please install python 3.8");
        process.exit(1);
    }
}
try {
    result = execSync("pip3 -V");
} catch (error) {
    console.log("pip not found. Try to install local.'");
    try {
        result = execSync("wget https://bootstrap.pypa.io/get-pip.py");
        result = execSync("python3 get-pip.py --user");
    } catch (error) {
        console.log("Local pip installation failed. Please install via 'sudo apt install python3-pip'");
        process.exit(1);
    }
}
result = result.toString("utf8");
console.log(result);
if (!result.includes("pip ")) {
    console.log("pip not found. Please install pip3. Via 'sudo apt install python3-pip'");
    process.exit(1);
}
console.log("Installing  midea-beautiful-air");
try {
    result = execSync("pip3 install --upgrade midea-beautiful-air -t .");
} catch (error) {
    console.log(error);
    process.exit(1);
}
result = result.toString("utf8");
console.log(result);
