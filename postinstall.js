const { execSync } = require("child_process");
console.log("\nStart Python package installation");
const local = checkPreconditions();

console.log("\nInstalling  midea-beautiful-air");
try {
    if (local) {
        execSync("$HOME/.local/bin/pip3 install --upgrade midea-beautiful-air"); //-t . for local install is not working with pythonia at the moment
    } else {
        execSync("pip3 install --upgrade midea-beautiful-air"); //-t . for local install is not working with pythonia at the moment
    }
} catch (error) {
    console.log(error);
    process.exit(1);
}

function checkPreconditions() {
    let result = "";
    try {
        result = execSync("python3 -V");
    } catch (error) {
        console.log("\nPython 3 not found. Please install minimum python 3.8");
        process.exit(1);
    }
    result = result.toString("utf8");
    console.log(result);
    if (!result.includes("Python 3")) {
        console.log("\nPython 3 not found. Please install minimum python 3.8");
        process.exit(1);
    } else {
        console.log("Python 3 found");
        const version = result.split(".")[1];
        if (version < 8) {
            console.log("\nPlease install python 3.8");
            process.exit(1);
        }
    }
    let local = false;
    try {
        result = execSync("pip3 -V");
    } catch (error) {
        console.log("\npip not found. Try to install local.");
        try {
            result = execSync("wget https://bootstrap.pypa.io/get-pip.py");
            result = execSync("python3 get-pip.py --user");
            console.log(result.toString("utf8"));
            result = execSync("$HOME/.local/bin/pip3 -V");
            local = true;
            console.log(result.toString("utf8"));
        } catch (error) {
            console.log(error);
            console.log("\nLocal pip installation failed. Please install via 'sudo apt install python3-pip'");
            process.exit(1);
        }
    }
    result = result.toString("utf8");
    console.log(result);
    if (!result.includes("pip ")) {
        console.log("pip not found. Please install pip3. Via 'sudo apt install python3-pip'");
        process.exit(1);
    }
    return local;
}
