const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const { MongoClient, Logger } = require("mongodb");
const objectId = require("mongodb").ObjectId;
require("dotenv").config();
const port = process.env.PORT || 5000;

// MIDDLEWARE
// app.use(cors());
const corsOptions = {
  origin: "https://books-library-client.vercel.app",
  credentials: true, //access-control-allow-credentials:true
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wanl6.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const verifyJWT = (req, res, next) => {
  const token = req.headers.accesstoken;
  if (!token) {
    res.status(401).send({ message: "Unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

const getMinute = (date) =>
  Math.floor((Date.now() - new Date(date).getTime()) / 1000) / 60;

async function run() {
  try {
    await client.connect();
    const database = client.db("LibraryApp");
    const bookCollection = database.collection("books");
    const userCollection = database.collection("users");

    Logger.setLevel("debug");
    client.on("commandStarted", (event) => console.debug(event));
    client.on("commandSucceeded", (event) => console.debug(event));
    client.on("commandFailed", (event) => console.debug(event));

    const verifyCreator = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterUser = await userCollection.findOne({
        email: requester,
      });
      if (requesterUser.role.includes("CREATOR")) {
        return next();
      }
      return res
        .status(401)
        .send({ message: "You are not allowed to create books" });
    };

    //   REGISTER USER
    app.post("/register", async (req, res) => {
      const { username, email, password } = req.body;
      bcrypt.hash(password, 10, async (err, hashedPass) => {
        const newUser = {
          username,
          email,
          password: hashedPass,
          role: ["VIEW_ALL"],
        };
        const isUserExist = await userCollection.findOne({ email });
        if (!isUserExist) {
          const result = await userCollection.insertOne(newUser);
          if (result.insertedId) {
            const token = jwt.sign(
              { email: email },
              process.env.ACCESS_TOKEN_SECRET
            );
            return res.send({
              status: "success",
              token,
              user: { username, email, role: ["VIEW_ALL"] },
              message: "Successfully registered",
            });
          }
          return res
            .status(401)
            .send({ status: "failed", message: "something is wrong" });
        }
        return res.status(401).send({
          status: "failed",
          message: "User Already Registered",
        });
      });
    });

    //   LOGIN USER
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      const user = await userCollection.findOne({ email });
      if (user) {
        bcrypt.compare(password, user.password, (err, result) => {
          if (err) {
            res.json({ error: err });
          }
          if (result) {
            let token = jwt.sign(
              { email: email },
              process.env.ACCESS_TOKEN_SECRET
            );
            res.json({
              status: "success",
              token,
              user: { email, username: user.username, role: user.role },
              message: "Successfully logged in",
            });
          } else {
            res
              .status(401)
              .send({ status: "failed", message: "password doesn't match" });
          }
        });
      } else {
        res.status(401).send({ status: "failed", message: "No user found" });
      }
    });

    // ADD USERS
    app.post("/addUser", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // USER CHECK
    app.get("/user", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      if (result) {
        const token = jwt.sign(
          { email: email },
          process.env.ACCESS_TOKEN_SECRET
        );
        return res.send({ result, token });
      }
      res.send({ error: "User not found" });
    });

    // UPDATE USER
    app.put("/update-user", verifyJWT, async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: user.role,
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      res.json(result);
    });

    // CREATE BOOK
    app.post("/books/", verifyJWT, verifyCreator, async (req, res) => {
      const result = await bookCollection.insertOne(req.body.bookDetails);
      res.json(result);
    });

    // DISPLAY BOOKS
    app.get("/books", verifyJWT, async (req, res) => {
      const oldBooks = req.query.old;
      const newBooks = req.query.New;
      const userEmail = req.query.email;
      const cursor = bookCollection.find(userEmail ? { email: userEmail } : {});
      const books = await cursor.toArray();
      if (oldBooks) {
        const filteredOldBooks = books.filter(
          (book) => getMinute(new Date(book.uploadDate)) > 10
        );
        return res.json(filteredOldBooks);
      } else if (newBooks) {
        const filteredNewBooks = books.filter(
          (book) => getMinute(new Date(book.uploadDate)) < 10
        );
        return res.json(filteredNewBooks);
      }
      res.json(books);
    });

    // CHECK BOOK BY ID OR USER EMAIL
    app.get("/book/", verifyJWT, async (req, res) => {
      if (req.query.email) {
        const email = req.query.email;
        const query = { email: email };
        const result = await bookCollection.findOne(query);
        res.json(result);
      } else if (req.query.id) {
        const id = req.query.id;
        const filter = { _id: objectId(id) };
        const cursor = bookCollection.find(filter);
        const result = await cursor.toArray();
        res.json(result[0]);
      }
    });

    // UPDATE BOOK
    app.put("/book/:id", verifyJWT, verifyCreator, async (req, res) => {
      const bookId = req.params.id;
      const filter = { _id: objectId(bookId) };
      const options = { upsert: true };

      const updateDoc = {
        $set: req.body.bookDetails,
      };
      const result = await bookCollection.updateOne(filter, updateDoc, options);
      res.json(result);
    });

    // DELETE BOOK
    app.delete("/books/delete", verifyJWT, async (req, res) => {
      const id = req.body.id;
      const query = { _id: objectId(id) };
      const result = await bookCollection.deleteOne(query);
      res.json(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
