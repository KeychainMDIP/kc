FROM ubuntu:22.04
RUN \
        apt-get update && \
        apt-get install -y software-properties-common && \
        apt-get install -y apt-utils && \
        apt-get install -y git vim less python3 && \
        apt-get install -y build-essential libtool autotools-dev automake pkg-config bsdmainutils && \
	apt-get install -y libboost-dev libboost-system-dev libboost-filesystem-dev libboost-test-dev libboost-thread-dev && \
	apt-get install -y libssl-dev libevent-dev libsqlite3-dev libminiupnpc-dev libzmq3-dev
RUN git clone -b 27.x https://github.com/bitcoin/bitcoin.git
WORKDIR /bitcoin
RUN ./autogen.sh
RUN ./configure --enable-wallet --disable-tests --disable-bench
RUN make
RUN make install
RUN strip /usr/local/bin/bitcoin*
RUN rm -rf /bitcoin
WORKDIR /root
RUN mkdir /root/.bitcoin
CMD ["bitcoind", "-printtoconsole"]